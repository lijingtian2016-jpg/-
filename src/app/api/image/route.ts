import { NextResponse } from "next/server";
import { z } from "zod";

import { ArkImageError, generateImageWithArk } from "@/lib/image-generation/ark-image-service";
import { createGeneratedImageRepository, GeneratedImageRepositoryError, type GeneratedImageRecord } from "@/lib/image-generation/generated-image-repository";
import { createClient } from "@/lib/supabase/server";
import { createR2ImageStorage, R2ImageError } from "@/lib/storage/r2-image-storage";

const imageRequestSchema = z.object({ prompt: z.string().trim().min(1).max(2_000) });

type SupabaseClient = {
  auth: { getUser(): Promise<{ data: { user: { id: string } | null }; error: unknown }> };
};
type ArkService = { generate(prompt: string): Promise<{ temporaryUrl: string; provider: string; model: string }> };
type ImageStorage = {
  persistTemporaryImage(temporaryUrl: string, userId: string): Promise<{ objectKey: string; permanentUrl: string }>;
  deleteObject(objectKey: string): Promise<void>;
};
type GeneratedImageRepository = { insert(record: GeneratedImageRecord): Promise<void> };
type Stage = "generate" | "persist" | "record" | "cleanup";
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
    if (error.code === "configuration" || error.code === "upload_failed")
      return { status: 502, message: "图片保存失败，请重试", category: error.code };
    return { status: 502, message: "图片生成失败，请重试", category: error.code };
  }
  if (error instanceof GeneratedImageRepositoryError || stage === "record")
    return { status: 500, message: "图片记录保存失败", category: "insert_failed" };
  return { status: 502, message: "图片生成失败，请重试", category: "unknown" };
}

export function createImagePostHandler(dependencies: ImageRouteDependencies) {
  return async function imagePost(request: Request) {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "请输入图片描述" }, { status: 400 });
    }
    const validation = imageRequestSchema.safeParse(body);
    if (!validation.success)
      return NextResponse.json({ error: "请输入图片描述" }, { status: 400 });

    const prompt = validation.data.prompt;
    const requestId = dependencies.createRequestId();
    const startedAt = dependencies.now();
    const supabase = await dependencies.createSupabaseClient();
    const { data, error: authError } = await supabase.auth.getUser();
    if (authError || !data.user)
      return NextResponse.json({ error: "请先登录" }, { status: 401 });

    const userId = data.user.id;
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
            durationMs: dependencies.now() - startedAt, provider, model,
            promptLength: prompt.length, errorCategory: cleanupFailure.category,
          });
        }
      }
      dependencies.logger.error({
        requestId, userId, stage, status: failure.status,
        durationMs: dependencies.now() - startedAt, provider, model,
        promptLength: prompt.length, errorCategory: failure.category,
      });
      return NextResponse.json({ error: failure.message }, { status: failure.status });
    }
  };
}

export const POST = createImagePostHandler(defaultDependencies);
