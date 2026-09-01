import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const awsMocks = vi.hoisted(() => ({
  send: vi.fn(),
  S3Client: vi.fn(),
  PutObjectCommand: vi.fn(),
  DeleteObjectCommand: vi.fn(),
}));

vi.mock("@aws-sdk/client-s3", () => ({
  S3Client: awsMocks.S3Client.mockImplementation(function S3Client() {
    return { send: awsMocks.send };
  }),
  PutObjectCommand: awsMocks.PutObjectCommand.mockImplementation(
    function PutObjectCommand(input) {
      return { kind: "put", input };
    },
  ),
  DeleteObjectCommand: awsMocks.DeleteObjectCommand.mockImplementation(
    function DeleteObjectCommand(input) {
      return { kind: "delete", input };
    },
  ),
}));

vi.mock("nanoid", () => ({ nanoid: () => "unique-id" }));

import { createR2ImageStorage, R2ImageError } from "./r2-image-storage";

const originalEnv = { ...process.env };
const validTemporaryUrl =
  "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/generated/image.jpeg";
const imageBytes = {
  "image/jpeg": new Uint8Array([0xff, 0xd8, 0xff, 0xe0]),
  "image/png": new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  "image/webp": new Uint8Array([
    0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ]),
} as const;

function imageResponse(
  body: BodyInit | null = imageBytes["image/jpeg"],
  options: { contentType?: string; contentLength?: string; status?: number } = {},
) {
  return new Response(body, {
    status: options.status ?? 200,
    headers: {
      ...(options.contentType === undefined
        ? { "content-type": "image/jpeg" }
        : { "content-type": options.contentType }),
      ...(options.contentLength === undefined
        ? {}
        : { "content-length": options.contentLength }),
    },
  });
}

async function expectR2Error(
  promise: Promise<unknown>,
  code: R2ImageError["code"],
) {
  await expect(promise).rejects.toMatchObject({
    name: "R2ImageError",
    code,
    message: code,
  });
}

describe("R2ImageError", () => {
  it("uses its stable code as its message", () => {
    const error = new R2ImageError("download_failed");

    expect(error).toMatchObject({
      name: "R2ImageError",
      code: "download_failed",
      message: "download_failed",
    });
  });
});

describe("createR2ImageStorage", () => {
  beforeEach(() => {
    process.env.R2_ACCESS_KEY_ID = "access";
    process.env.R2_SECRET_ACCESS_KEY = "secret";
    process.env.R2_ENDPOINT = "https://account.r2.cloudflarestorage.com";
    process.env.R2_BUCKET_NAME = "images";
    process.env.R2_PUBLIC_URL = "https://cdn.example.com///";
    awsMocks.send.mockReset().mockResolvedValue({});
    awsMocks.S3Client.mockClear();
    awsMocks.PutObjectCommand.mockClear();
    awsMocks.DeleteObjectCommand.mockClear();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_ENDPOINT",
    "R2_BUCKET_NAME",
    "R2_PUBLIC_URL",
  ])("rejects missing configuration %s", (name) => {
    delete process.env[name];

    expect(() => createR2ImageStorage()).toThrowError(
      expect.objectContaining({ code: "configuration" }),
    );
  });

  it("configures the R2 client without exposing configuration in its API", () => {
    createR2ImageStorage();

    expect(awsMocks.S3Client).toHaveBeenCalledWith({
      region: "auto",
      endpoint: "https://account.r2.cloudflarestorage.com",
      credentials: { accessKeyId: "access", secretAccessKey: "secret" },
    });
  });

  it.each([
    "http://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/image.png",
    "https://user:password@ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com/image.png",
    "https://ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com:8443/image.png",
    "https://localhost/image.png",
    "https://127.0.0.1/image.png",
    "https://10.0.0.1/image.png",
    "https://169.254.169.254/latest/meta-data",
    "https://example.com/image.png",
    "https://ark-content-generation-attacker-cn-beijing.tos-cn-beijing.volces.com/image.png",
    "not-a-url",
  ])("rejects unsafe temporary URL %s before fetching", async (url) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const storage = createR2ImageStorage({ fetchImpl });

    await expectR2Error(
      storage.persistTemporaryImage(url, "user-1"),
      "invalid_url",
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("downloads and uploads a validated user-scoped JPEG", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        imageResponse(imageBytes["image/jpeg"], {
          contentType: "image/jpeg; charset=binary",
          contentLength: "4",
        }),
      );
    const storage = createR2ImageStorage({ fetchImpl });

    await expect(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
    ).resolves.toEqual({
      objectKey: "images/user-1/unique-id.jpeg",
      permanentUrl: "https://cdn.example.com/images/user-1/unique-id.jpeg",
    });
    expect(fetchImpl).toHaveBeenCalledWith(validTemporaryUrl, {
      redirect: "error",
      signal: expect.any(AbortSignal),
    });
    expect(awsMocks.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "images",
      Key: "images/user-1/unique-id.jpeg",
      Body: Buffer.from(imageBytes["image/jpeg"]),
      ContentType: "image/jpeg",
    });
    expect(awsMocks.send).toHaveBeenCalledWith(
      {
        kind: "put",
        input: expect.objectContaining({
          Key: "images/user-1/unique-id.jpeg",
          ContentType: "image/jpeg",
        }),
      },
      { abortSignal: expect.any(AbortSignal) },
    );
  });

  it.each([
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("uses the verified %s MIME and extension", async (contentType, extension) => {
    const storage = createR2ImageStorage({
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(
          imageResponse(imageBytes[contentType as keyof typeof imageBytes], {
            contentType,
          }),
        ),
    });

    await expect(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
    ).resolves.toMatchObject({
      objectKey: `images/user-1/unique-id.${extension}`,
    });
    expect(awsMocks.PutObjectCommand).toHaveBeenCalledWith(
      expect.objectContaining({ ContentType: contentType }),
    );
  });

  it.each(["text/html", "image/svg+xml", "", "IMAGE/PNG"]) (
    "rejects unsupported content type %s",
    async (contentType) => {
      const storage = createR2ImageStorage({
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(imageResponse("bad", { contentType })),
      });

      await expectR2Error(
        storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
        "unsupported_type",
      );
      expect(awsMocks.send).not.toHaveBeenCalled();
    },
  );

  it("rejects a declared image larger than ten MiB before buffering", async () => {
    const arrayBuffer = vi.fn();
    const response = imageResponse(null, {
      contentType: "image/png",
      contentLength: String(10 * 1024 * 1024 + 1),
    });
    response.arrayBuffer = arrayBuffer;
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "too_large",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(awsMocks.send).not.toHaveBeenCalled();
  });

  it("stops and cancels a streamed image as soon as it exceeds ten MiB", async () => {
    const cancel = vi.fn().mockResolvedValue(undefined);
    const chunks = [
      new Uint8Array(6 * 1024 * 1024),
      new Uint8Array(5 * 1024 * 1024),
    ];
    chunks[0].set(imageBytes["image/png"]);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: chunks[0] })
      .mockResolvedValueOnce({ done: false, value: chunks[1] });
    const response = {
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: {
        getReader: () => ({ read, cancel, releaseLock: vi.fn() }),
      },
    } as unknown as Response;
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "too_large",
    );
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
    expect(awsMocks.send).not.toHaveBeenCalled();
  });

  it("rejects a response without a readable stream before allocating its body", async () => {
    const arrayBuffer = vi
      .fn()
      .mockResolvedValue(new Uint8Array(10 * 1024 * 1024 + 1).buffer);
    const response = {
      ok: true,
      headers: new Headers({ "content-type": "image/png" }),
      body: null,
      arrayBuffer,
    } as unknown as Response;
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "download_failed",
    );
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it.each([
    ["image/jpeg", imageBytes["image/png"]],
    ["image/png", imageBytes["image/webp"]],
    ["image/webp", imageBytes["image/jpeg"]],
  ] as const)("rejects bytes spoofed as %s", async (contentType, body) => {
    const storage = createR2ImageStorage({
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(imageResponse(body, { contentType })),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "unsupported_type",
    );
    expect(awsMocks.send).not.toHaveBeenCalled();
  });

  it("aborts a stalled download after thirty seconds and clears its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchImpl = vi.fn<typeof fetch>((_url, init) => {
      signal = init?.signal ?? undefined;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const storage = createR2ImageStorage({ fetchImpl });
    const result = storage.persistTemporaryImage(validTemporaryUrl, "user-1");
    const rejection = expectR2Error(result, "download_failed");

    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("maps network and non-success responses to download_failed", async () => {
    const networkFailure = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockRejectedValue(new Error("offline")),
    });
    await expectR2Error(
      networkFailure.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "download_failed",
    );

    const httpFailure = createR2ImageStorage({
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(imageResponse(null, { status: 503 })),
    });
    await expectR2Error(
      httpFailure.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "download_failed",
    );
  });

  it("maps unreadable response bodies to download_failed", async () => {
    const response = {
      ok: true,
      headers: new Headers({ "content-type": "image/jpeg" }),
      body: null,
      arrayBuffer: vi.fn().mockRejectedValue(new Error("stream failed")),
    } as unknown as Response;
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "download_failed",
    );
  });

  it("maps R2 upload failures to upload_failed", async () => {
    awsMocks.send.mockRejectedValueOnce(new Error("upload failed"));
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(imageResponse()),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "upload_failed",
    );
  });

  it("aborts a stalled R2 upload after thirty seconds and clears its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    awsMocks.send.mockImplementation((_command, options) => {
      signal = options?.abortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(imageResponse()),
    });
    const result = storage.persistTemporaryImage(validTemporaryUrl, "user-1");
    const rejection = expectR2Error(result, "upload_failed");

    await vi.advanceTimersByTimeAsync(0);
    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("deletes an uploaded object by key", async () => {
    const storage = createR2ImageStorage({ fetchImpl: vi.fn<typeof fetch>() });

    await expect(
      storage.deleteObject("images/user-1/unique-id.jpeg"),
    ).resolves.toBeUndefined();
    expect(awsMocks.DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: "images",
      Key: "images/user-1/unique-id.jpeg",
    });
    expect(awsMocks.send).toHaveBeenCalledWith(
      expect.objectContaining({ kind: "delete" }),
      { abortSignal: expect.any(AbortSignal) },
    );
  });

  it("maps R2 delete failures to delete_failed", async () => {
    awsMocks.send.mockRejectedValueOnce(new Error("delete failed"));
    const storage = createR2ImageStorage({ fetchImpl: vi.fn<typeof fetch>() });

    await expectR2Error(
      storage.deleteObject("images/user-1/unique-id.jpeg"),
      "delete_failed",
    );
  });

  it("aborts a stalled R2 delete after thirty seconds and clears its timer", async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    awsMocks.send.mockImplementation((_command, options) => {
      signal = options?.abortSignal;
      return new Promise((_resolve, reject) => {
        signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      });
    });
    const storage = createR2ImageStorage({ fetchImpl: vi.fn<typeof fetch>() });
    const result = storage.deleteObject("images/user-1/unique-id.jpeg");
    const rejection = expectR2Error(result, "delete_failed");

    expect(signal).toBeInstanceOf(AbortSignal);
    await vi.advanceTimersByTimeAsync(30_000);
    await rejection;
    expect(signal?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
