export type ArkImageErrorCode =
  | "configuration"
  | "invalid_credentials"
  | "rate_limited"
  | "timeout"
  | "invalid_response"
  | "upstream_failure";

export class ArkImageError extends Error {
  public readonly name = "ArkImageError";

  public constructor(public readonly code: ArkImageErrorCode) {
    super(code);
  }
}

type GenerateImageWithArkOptions = {
  fetchImpl?: typeof fetch;
};

type ArkImageResult = {
  temporaryUrl: string;
  provider: "volcengine-ark";
  model: string;
};

const DEFAULT_API_URL =
  "https://ark.cn-beijing.volces.com/api/v3/images/generations";
const DEFAULT_TIMEOUT_MS = 60_000;

export async function generateImageWithArk(
  prompt: string,
  { fetchImpl = fetch }: GenerateImageWithArkOptions = {},
): Promise<ArkImageResult> {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_IMAGE_MODEL;

  if (!apiKey || !model) {
    throw new ArkImageError("configuration");
  }

  const timeoutMs = Number(
    process.env.ARK_IMAGE_TIMEOUT_MS ?? String(DEFAULT_TIMEOUT_MS),
  );

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ArkImageError("configuration");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(
      process.env.ARK_IMAGE_API_URL || DEFAULT_API_URL,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          prompt,
          response_format: "url",
          sequential_image_generation: "disabled",
          watermark: false,
        }),
        signal: controller.signal,
      },
    );

    if (!response.ok) {
      const code: ArkImageErrorCode =
        response.status === 401
          ? "invalid_credentials"
          : response.status === 429
            ? "rate_limited"
            : "upstream_failure";
      throw new ArkImageError(code);
    }

    const payload: unknown = await response.json();
    const temporaryUrl = getTemporaryUrl(payload);
    if (!temporaryUrl) {
      throw new ArkImageError("invalid_response");
    }

    return { temporaryUrl, provider: "volcengine-ark", model };
  } catch (error) {
    if (error instanceof ArkImageError) {
      throw error;
    }
    if (isAbortError(error)) {
      throw new ArkImageError("timeout");
    }
    throw new ArkImageError("upstream_failure");
  } finally {
    clearTimeout(timeout);
  }
}

function getTemporaryUrl(payload: unknown): string | undefined {
  if (!payload || typeof payload !== "object") return undefined;
  const data = (payload as { data?: unknown }).data;
  if (!Array.isArray(data)) return undefined;
  const first = data[0];
  if (!first || typeof first !== "object") return undefined;
  const url = (first as { url?: unknown }).url;
  return typeof url === "string" && url.length > 0 ? url : undefined;
}

function isAbortError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "name" in error &&
    error.name === "AbortError"
  );
}
