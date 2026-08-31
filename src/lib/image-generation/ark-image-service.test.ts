import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ArkImageError, generateImageWithArk } from "./ark-image-service";

const originalEnv = { ...process.env };

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function expectArkError(
  promise: Promise<unknown>,
  code: ArkImageError["code"],
) {
  await expect(promise).rejects.toMatchObject({
    name: "ArkImageError",
    code,
  });
}

describe("ArkImageError", () => {
  it("uses its code as its message and exposes its identity", () => {
    const error = new ArkImageError("timeout");

    expect(error.message).toBe("timeout");
    expect(error.code).toBe("timeout");
    expect(error.name).toBe("ArkImageError");
  });
});

describe("generateImageWithArk", () => {
  beforeEach(() => {
    process.env.ARK_API_KEY = "secret-test-key";
    process.env.ARK_IMAGE_MODEL = "seedream-test-model";
    delete process.env.ARK_IMAGE_API_URL;
    delete process.env.ARK_IMAGE_TIMEOUT_MS;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it("posts the exact Ark request and returns the temporary image URL", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { data: [{ url: "https://temporary.example/image.png" }] }),
    );

    await expect(
      generateImageWithArk("draw a paper doll", { fetchImpl }),
    ).resolves.toEqual({
      temporaryUrl: "https://temporary.example/image.png",
      provider: "volcengine-ark",
      model: "seedream-test-model",
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(
      "https://ark.cn-beijing.volces.com/api/v3/images/generations",
    );
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: "Bearer secret-test-key",
        "Content-Type": "application/json",
      },
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "seedream-test-model",
      prompt: "draw a paper doll",
      response_format: "url",
      sequential_image_generation: "disabled",
      watermark: false,
    });
  });

  it("posts to a configured Ark API URL", async () => {
    process.env.ARK_IMAGE_API_URL = "https://ark.example/custom-images";
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      response(200, { data: [{ url: "https://temporary.example/image.png" }] }),
    );

    await generateImageWithArk("prompt", { fetchImpl });

    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ark.example/custom-images",
      expect.any(Object),
    );
  });

  it.each(["ARK_API_KEY", "ARK_IMAGE_MODEL"])(
    "reports configuration when %s is missing",
    async (name) => {
      delete process.env[name];
      await expectArkError(
        generateImageWithArk("prompt", { fetchImpl: vi.fn() }),
        "configuration",
      );
    },
  );

  it.each(["", "0", "-1", "not-a-number", "Infinity"])(
    "reports configuration for invalid timeout %s",
    async (timeout) => {
      process.env.ARK_IMAGE_TIMEOUT_MS = timeout;
      await expectArkError(
        generateImageWithArk("prompt", { fetchImpl: vi.fn() }),
        "configuration",
      );
    },
  );

  it.each([
    [401, "invalid_credentials"],
    [429, "rate_limited"],
    [500, "upstream_failure"],
  ] as const)("maps HTTP %i to %s", async (status, code) => {
    await expectArkError(
      generateImageWithArk("prompt", {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(response(status, {})),
      }),
      code,
    );
  });

  it("rejects a successful response without an image URL", async () => {
    await expectArkError(
      generateImageWithArk("prompt", {
        fetchImpl: vi
          .fn<typeof fetch>()
          .mockResolvedValue(response(200, { data: [] })),
      }),
      "invalid_response",
    );
  });

  it("maps malformed JSON to an upstream failure", async () => {
    const malformed = new Response("not json", { status: 200 });
    await expectArkError(
      generateImageWithArk("prompt", {
        fetchImpl: vi.fn<typeof fetch>().mockResolvedValue(malformed),
      }),
      "upstream_failure",
    );
  });

  it("aborts at the configured timeout and reports a timeout", async () => {
    process.env.ARK_IMAGE_TIMEOUT_MS = "5";
    const fetchImpl = vi.fn<typeof fetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("aborted", "AbortError"));
        });
      }),
    );

    await expectArkError(
      generateImageWithArk("prompt", { fetchImpl }),
      "timeout",
    );
  });
});
