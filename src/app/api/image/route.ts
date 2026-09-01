import { NextResponse } from "next/server";
import { z } from "zod";

import { ArkImageError, generateImageWithArk } from "@/lib/image-generation/ark-image-service";
import { createGeneratedImageRepository, GeneratedImageRepositoryError, type GeneratedImageRecord } from "@/lib/image-generation/generated-image-repository";
import { createClient } from "@/lib/supabase/server";
import { createR2ImageStorage, R2ImageError } from "@/lib/storage/r2-image-storage";

const imageRequestSchema = z.object({ prompt: z.string().trim().min(1).max(2_000) });
const MAX_REQUEST_BYTES = 16 * 1024;

type SupabaseClient = {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};
type ArkService = { generate(prompt: string): Promise<{ temporaryUrl: string; provider: string; model: string }> };
type ImageStorage = {
  persistTemporaryImage(temporaryUrl: string, userId: string): Promise<{ objectKey: string; permanentUrl: string }>;
  deleteObject(objectKey: string): Promise<void>;
};
type GeneratedImageRepository = { insert(record: GeneratedImageRecord): Promise<void> };
type Stage = "authenticate" | "generate" | "persist" | "record" | "cleanup";
type SafeLog = {
  requestId: string;
  userId: string;
  stage: Stage;
  status: number;
  durationMs: number;
  provider: string;
  model: string;
  promptLength: number;
  errorCategory: string;
};

export type ImageRouteDependencies = {
  createSupabaseClient(): Promise<SupabaseClient>;
  createArkImageService(): ArkService;
  createR2ImageStorage(): ImageStorage;
  createGeneratedImageRepository(client: SupabaseClient): GeneratedImageRepository;
  createRequestId(): string;
  now(): number;
  logger: { error(entry: SafeLog): void };
};

const defaultDependencies: ImageRouteDependencies = {
  createSupabaseClient: createClient,
  createArkImageService: () => ({ generate: generateImageWithArk }),
  createR2ImageStorage,
  createGeneratedImageRepository: (client) =>
    createGeneratedImageRepository(
      client as unknown as Parameters<typeof createGeneratedImageRepository>[0],
    ),
  createRequestId: () => crypto.randomUUID(),
  now: () => Date.now(),
  logger: { error: (entry) => console.error(entry) },
};

type Failure = { status: number; message: string; category: string };

function mapFailure(error: unknown, stage: Stage): Failure {
  if (error instanceof ArkImageError) {
    if (error.code === "configuration" || error.code === "invalid_credentials")
      return { status: 502, message: "图片服务配置异常", category: error.code };
    if (error.code === "rate_limited")
      return { status: 429, message: "图片生成过于频繁，请稍后再试", category: error.code };
    if (error.code === "timeout")
      return { status: 504, message: "图片生成超时，请重试", category: error.code };
    return { status: 502, message: "图片生成失败，请重试", category: error.code };
  }
  if (error instanceof R2ImageError) {
    if (error.code === "configuration" || error.code === "invalid_url" || error.code === "upload_failed")
      return { status: 502, message: "图片保存失败，请重试", category: error.code };
    return { status: 502, message: "图片生成失败，请重试", category: error.code };
  }
  if (error instanceof GeneratedImageRepositoryError || stage === "record")
    return { status: 500, message: "图片记录保存失败", category: "insert_failed" };
  return { status: 500, message: "图片生成失败，请重试", category: "unknown" };
}

async function parseBoundedJson(request: Request): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_REQUEST_BYTES)
    throw new Error("invalid_body");
  if (!request.body) throw new Error("invalid_body");

  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let bytesRead = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      bytesRead += value.byteLength;
      if (bytesRead > MAX_REQUEST_BYTES) {
        await reader.cancel().catch(() => undefined);
        throw new Error("invalid_body");
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return JSON.parse(text) as unknown;
  } finally {
    try { reader.releaseLock(); } catch { /* already released */ }
  }
}

function safeNow(dependencies: ImageRouteDependencies): number {
  try { return dependencies.now(); } catch { return 0; }
}

function safeRequestId(dependencies: ImageRouteDependencies): string {
  try { return dependencies.createRequestId(); } catch { return "unknown"; }
}

export function createImagePostHandler(dependencies: ImageRouteDependencies) {
  return async function imagePost(request: Request) {
    const requestId = safeRequestId(dependencies);
    const startedAt = safeNow(dependencies);
    let supabase: SupabaseClient;
    try {
      supabase = await dependencies.createSupabaseClient();
      const { data, error: authError } = await supabase.auth.getUser();
      if (authError || !data.user)
        return NextResponse.json({ error: "请先登录" }, { status: 401 });

      const userId = data.user.id;
      return await handleAuthenticatedRequest(
        request, userId, supabase, requestId, startedAt, dependencies,
      );
    } catch {
      dependencies.logger.error({
        requestId, userId: "unknown", stage: "authenticate", status: 500,
        durationMs: safeNow(dependencies) - startedAt, provider: "unknown",
        model: "unknown", promptLength: 0, errorCategory: "unknown",
      });
      return NextResponse.json({ error: "图片生成失败，请重试" }, { status: 500 });
    }
  };
}

async function handleAuthenticatedRequest(
  request: Request,
  userId: string,
  supabase: SupabaseClient,
  requestId: string,
  startedAt: number,
  dependencies: ImageRouteDependencies,
) {
    let body: unknown;
    try {
      body = await parseBoundedJson(request);
    } catch {
      return NextResponse.json({ error: "请输入图片描述" }, { status: 400 });
    }
    const validation = imageRequestSchema.safeParse(body);
    if (!validation.success)
      return NextResponse.json({ error: "请输入图片描述" }, { status: 400 });

    const prompt = validation.data.prompt;
    let stage: Stage = "generate";
    let provider = "volcengine-ark";
    let model = "unknown";
    let storage: ImageStorage | undefined;
    let objectKey: string | undefined;
    try {
      const generated = await dependencies.createArkImageService().generate(prompt);
      provider = generated.provider;
      model = generated.model;
      stage = "persist";
      storage = dependencies.createR2ImageStorage();
      const persisted = await storage.persistTemporaryImage(generated.temporaryUrl, userId);
      objectKey = persisted.objectKey;
      stage = "record";
      await dependencies.createGeneratedImageRepository(supabase).insert({
        userId, imageUrl: persisted.permanentUrl, objectKey, prompt, provider, model,
      });
      return NextResponse.json({ imageUrl: persisted.permanentUrl });
    } catch (error) {
      const failure = mapFailure(error, stage);
      if (stage === "record" && storage && objectKey) {
        try {
          await storage.deleteObject(objectKey);
        } catch (cleanupError) {
          const cleanupFailure = mapFailure(cleanupError, "cleanup");
          dependencies.logger.error({
            requestId, userId, stage: "cleanup", status: cleanupFailure.status,
            durationMs: safeNow(dependencies) - startedAt, provider, model,
            promptLength: prompt.length, errorCategory: cleanupFailure.category,
          });
        }
      }
      dependencies.logger.error({
        requestId, userId, stage, status: failure.status,
        durationMs: safeNow(dependencies) - startedAt, provider, model,
        promptLength: prompt.length, errorCategory: failure.category,
      });
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
}

export const POST = createImagePostHandler(defaultDependencies);
