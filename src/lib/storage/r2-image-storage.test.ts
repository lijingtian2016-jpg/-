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

function imageResponse(
  body: BodyInit | null = new Uint8Array([1, 2, 3]),
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
        imageResponse(new Uint8Array([1, 2, 3]), {
          contentType: "image/jpeg; charset=binary",
          contentLength: "3",
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
    });
    expect(awsMocks.PutObjectCommand).toHaveBeenCalledWith({
      Bucket: "images",
      Key: "images/user-1/unique-id.jpeg",
      Body: Buffer.from([1, 2, 3]),
      ContentType: "image/jpeg",
    });
    expect(awsMocks.send).toHaveBeenCalledWith({
      kind: "put",
      input: expect.objectContaining({
        Key: "images/user-1/unique-id.jpeg",
        ContentType: "image/jpeg",
      }),
    });
  });

  it.each([
    ["image/png", "png"],
    ["image/webp", "webp"],
  ])("uses the verified %s MIME and extension", async (contentType, extension) => {
    const storage = createR2ImageStorage({
      fetchImpl: vi
        .fn<typeof fetch>()
        .mockResolvedValue(imageResponse(null, { contentType })),
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

  it("rejects an actual image body larger than ten MiB", async () => {
    const storage = createR2ImageStorage({
      fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(
        imageResponse(new Uint8Array(10 * 1024 * 1024 + 1), {
          contentType: "image/webp",
        }),
      ),
    });

    await expectR2Error(
      storage.persistTemporaryImage(validTemporaryUrl, "user-1"),
      "too_large",
    );
    expect(awsMocks.send).not.toHaveBeenCalled();
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
    const response = imageResponse();
    response.arrayBuffer = vi.fn().mockRejectedValue(new Error("stream failed"));
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

  it("deletes an uploaded object by key", async () => {
    const storage = createR2ImageStorage({ fetchImpl: vi.fn<typeof fetch>() });

    await expect(
      storage.deleteObject("images/user-1/unique-id.jpeg"),
    ).resolves.toBeUndefined();
    expect(awsMocks.DeleteObjectCommand).toHaveBeenCalledWith({
      Bucket: "images",
      Key: "images/user-1/unique-id.jpeg",
    });
  });

  it("maps R2 delete failures to delete_failed", async () => {
    awsMocks.send.mockRejectedValueOnce(new Error("delete failed"));
    const storage = createR2ImageStorage({ fetchImpl: vi.fn<typeof fetch>() });

    await expectR2Error(
      storage.deleteObject("images/user-1/unique-id.jpeg"),
      "delete_failed",
    );
  });
});
