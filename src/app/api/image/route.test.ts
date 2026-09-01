import { beforeEach, describe, expect, it, vi } from "vitest";

import { ArkImageError } from "@/lib/image-generation/ark-image-service";
import { GeneratedImageRepositoryError } from "@/lib/image-generation/generated-image-repository";
import { R2ImageError } from "@/lib/storage/r2-image-storage";
import { createImagePostHandler, type ImageRouteDependencies } from "./route";

const userId = "user-server-side";
const temporaryUrl = "https://ark.example/secret-temporary-url";
const permanentUrl = "https://cdn.example/images/user-server-side/result.png";
const objectKey = "images/user-server-side/result.png";

function request(body: string) {
  return new Request("http://localhost/api/image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
}

function setup(overrides: Partial<ImageRouteDependencies> = {}) {
  const calls: string[] = [];
  const getUser = vi.fn(async () => {
    calls.push("auth");
    return { data: { user: { id: userId } }, error: null };
  });
  const supabase = { auth: { getUser } };
  const generate = vi.fn(async (prompt: string) => {
    calls.push(`generate:${prompt}`);
    return { temporaryUrl, provider: "volcengine-ark", model: "seedream-v4" };
  });
  const persistTemporaryImage = vi.fn(async (url: string, id: string) => {
    calls.push(`persist:${url}:${id}`);
    return { objectKey, permanentUrl };
  });
  const deleteObject = vi.fn(async (key: string) => {
    calls.push(`delete:${key}`);
  });
  const insert = vi.fn(async (record) => {
    calls.push(`insert:${record.imageUrl}`);
  });
  const logger = { error: vi.fn() };
  const dependencies: ImageRouteDependencies = {
    createSupabaseClient: vi.fn(async () => supabase),
    createArkImageService: vi.fn(() => ({ generate })),
    createR2ImageStorage: vi.fn(() => ({ persistTemporaryImage, deleteObject })),
    createGeneratedImageRepository: vi.fn(() => ({ insert })),
    createRequestId: () => "request-123",
    now: (() => {
      let value = 100;
      return () => value++;
    })(),
    logger,
    ...overrides,
  };
  return {
    handler: createImagePostHandler(dependencies), dependencies, calls, getUser,
    generate, persistTemporaryImage, deleteObject, insert, logger,
  };
}

async function json(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("POST /api/image", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("requires a server-authenticated user before generating", async () => {
    const getUser = vi.fn(async () => ({ data: { user: null }, error: null }));
    const { handler, generate } = setup({
      createSupabaseClient: vi.fn(async () => ({ auth: { getUser } })),
    });

    const response = await handler(request(JSON.stringify({ prompt: "hello" })));

    expect(response.status).toBe(401);
    await expect(json(response)).resolves.toEqual({ error: "请先登录" });
    expect(generate).not.toHaveBeenCalled();
  });

  it.each([
    ["invalid JSON", "{"],
    ["missing prompt", JSON.stringify({})],
    ["blank prompt", JSON.stringify({ prompt: " \n " })],
    ["long prompt", JSON.stringify({ prompt: "x".repeat(2001) })],
  ])("returns the stable validation response for %s", async (_name, body) => {
    const { handler, generate } = setup();
    const response = await handler(request(body));
    expect(response.status).toBe(400);
    await expect(json(response)).resolves.toEqual({ error: "请输入图片描述" });
    expect(generate).not.toHaveBeenCalled();
  });

  it("trims the prompt and persists the permanent URL in exact order", async () => {
    const { handler, calls, insert } = setup();
    const response = await handler(
      request(JSON.stringify({ prompt: "  paper doll portrait  ", userId: "attacker" })),
    );

    expect(response.status).toBe(200);
    await expect(json(response)).resolves.toEqual({ imageUrl: permanentUrl });
    expect(calls).toEqual([
      "auth",
      "generate:paper doll portrait",
      `persist:${temporaryUrl}:${userId}`,
      `insert:${permanentUrl}`,
    ]);
    expect(insert).toHaveBeenCalledWith({
      userId,
      imageUrl: permanentUrl,
      objectKey,
      prompt: "paper doll portrait",
      provider: "volcengine-ark",
      model: "seedream-v4",
    });
  });

  it.each([
    ["configuration", 502, "图片服务配置异常"],
    ["invalid_credentials", 502, "图片服务配置异常"],
    ["rate_limited", 429, "图片生成过于频繁，请稍后再试"],
    ["timeout", 504, "图片生成超时，请重试"],
    ["upstream_failure", 502, "图片生成失败，请重试"],
    ["invalid_response", 502, "图片生成失败，请重试"],
  ] as const)("maps Ark %s", async (code, status, message) => {
    const { handler, dependencies } = setup();
    vi.mocked(dependencies.createArkImageService).mockReturnValue({
      generate: vi.fn(async () => { throw new ArkImageError(code); }),
    });
    const response = await handler(request(JSON.stringify({ prompt: "hello" })));
    expect(response.status).toBe(status);
    await expect(json(response)).resolves.toEqual({ error: message });
  });

  it.each([
    ["invalid_url", 502, "图片生成失败，请重试"],
    ["download_failed", 502, "图片生成失败，请重试"],
    ["unsupported_type", 502, "图片生成失败，请重试"],
    ["too_large", 502, "图片生成失败，请重试"],
    ["configuration", 502, "图片保存失败，请重试"],
    ["upload_failed", 502, "图片保存失败，请重试"],
  ] as const)("maps R2 %s", async (code, status, message) => {
    const { handler, dependencies } = setup();
    vi.mocked(dependencies.createR2ImageStorage).mockReturnValue({
      persistTemporaryImage: vi.fn(async () => { throw new R2ImageError(code); }),
      deleteObject: vi.fn(),
    });
    const response = await handler(request(JSON.stringify({ prompt: "hello" })));
    expect(response.status).toBe(status);
    await expect(json(response)).resolves.toEqual({ error: message });
  });

  it("deletes the uploaded object once when repository insertion fails", async () => {
    const { handler, insert, deleteObject } = setup();
    insert.mockRejectedValueOnce(new GeneratedImageRepositoryError());
    const response = await handler(request(JSON.stringify({ prompt: "hello" })));
    expect(response.status).toBe(500);
    await expect(json(response)).resolves.toEqual({ error: "图片记录保存失败" });
    expect(deleteObject).toHaveBeenCalledTimes(1);
    expect(deleteObject).toHaveBeenCalledWith(objectKey);
  });

  it("keeps the repository response when compensating deletion fails", async () => {
    const { handler, insert, deleteObject } = setup();
    insert.mockRejectedValueOnce(new GeneratedImageRepositoryError());
    deleteObject.mockRejectedValueOnce(new R2ImageError("delete_failed"));
    const response = await handler(request(JSON.stringify({ prompt: "hello" })));
    expect(response.status).toBe(500);
    await expect(json(response)).resolves.toEqual({ error: "图片记录保存失败" });
    expect(deleteObject).toHaveBeenCalledTimes(1);
  });

  it("logs only safe structured metadata and never leaks internal values", async () => {
    const secretPrompt = "SECRET PROMPT";
    const secretMessage = "SECRET API KEY and provider body";
    const { handler, dependencies, logger } = setup();
    vi.mocked(dependencies.createArkImageService).mockReturnValue({
      generate: vi.fn(async () => { throw new Error(secretMessage); }),
    });
    const response = await handler(request(JSON.stringify({ prompt: secretPrompt })));
    expect(response.status).toBe(502);
    const responseText = await response.text();
    expect(responseText).not.toContain(secretPrompt);
    expect(responseText).not.toContain(secretMessage);
    expect(responseText).not.toContain(temporaryUrl);
    expect(logger.error).toHaveBeenCalledTimes(1);
    const serializedLogs = JSON.stringify(logger.error.mock.calls);
    for (const secret of [secretPrompt, secretMessage, temporaryUrl, permanentUrl]) {
      expect(serializedLogs).not.toContain(secret);
    }
    expect(logger.error).toHaveBeenCalledWith({
      requestId: "request-123",
      userId,
      stage: "generate",
      status: 502,
      durationMs: expect.any(Number),
      provider: "volcengine-ark",
      model: "unknown",
      promptLength: secretPrompt.length,
      errorCategory: "unknown",
    });
  });
});
