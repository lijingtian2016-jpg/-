import {
  DeleteObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { nanoid } from "nanoid";

export type R2ImageErrorCode =
  | "configuration"
  | "invalid_url"
  | "download_failed"
  | "unsupported_type"
  | "too_large"
  | "upload_failed"
  | "delete_failed";

export class R2ImageError extends Error {
  constructor(public readonly code: R2ImageErrorCode) {
    super(code);
    this.name = "R2ImageError";
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 30_000;
const ARK_IMAGE_HOST =
  "ark-content-generation-v2-cn-beijing.tos-cn-beijing.volces.com";
const EXTENSIONS: Readonly<Record<string, string>> = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
};

function isAllowedTemporaryImageUrl(value: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }

  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    (url.port !== "" && url.port !== "443")
  ) {
    return false;
  }

  return url.hostname === ARK_IMAGE_HOST;
}

async function readBoundedBody(response: Response): Promise<Buffer> {
  if (!response.body) {
    let body: Buffer;
    try {
      body = Buffer.from(await response.arrayBuffer());
    } catch {
      throw new R2ImageError("download_failed");
    }
    if (body.byteLength > MAX_IMAGE_BYTES) {
      throw new R2ImageError("too_large");
    }
    return body;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      totalBytes += value.byteLength;
      if (totalBytes > MAX_IMAGE_BYTES) {
        try {
          await reader.cancel();
        } catch {
          // The size error remains the useful, stable public failure.
        }
        throw new R2ImageError("too_large");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (error instanceof R2ImageError) throw error;
    throw new R2ImageError("download_failed");
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // The reader may already be released by an aborted response.
    }
  }

  return Buffer.concat(chunks, totalBytes);
}

function matchesImageSignature(contentType: string, body: Buffer): boolean {
  if (contentType === "image/jpeg") {
    return (
      body.length >= 3 &&
      body[0] === 0xff &&
      body[1] === 0xd8 &&
      body[2] === 0xff
    );
  }
  if (contentType === "image/png") {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    return signature.every((byte, index) => body[index] === byte);
  }
  if (contentType === "image/webp") {
    return (
      body.length >= 12 &&
      body.subarray(0, 4).toString("ascii") === "RIFF" &&
      body.subarray(8, 12).toString("ascii") === "WEBP"
    );
  }
  return false;
}

function requireEnvironment(name: string): string {
  const value = process.env[name];
  if (!value) throw new R2ImageError("configuration");
  return value;
}

export function createR2ImageStorage(
  options: { fetchImpl?: typeof fetch } = {},
) {
  const accessKeyId = requireEnvironment("R2_ACCESS_KEY_ID");
  const secretAccessKey = requireEnvironment("R2_SECRET_ACCESS_KEY");
  const endpoint = requireEnvironment("R2_ENDPOINT");
  const bucket = requireEnvironment("R2_BUCKET_NAME");
  const publicUrl = requireEnvironment("R2_PUBLIC_URL").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;
  const client = new S3Client({
    region: "auto",
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });

  return {
    async persistTemporaryImage(temporaryUrl: string, userId: string) {
      if (!isAllowedTemporaryImageUrl(temporaryUrl)) {
        throw new R2ImageError("invalid_url");
      }

      const abortController = new AbortController();
      const timeout = setTimeout(
        () => abortController.abort(),
        DOWNLOAD_TIMEOUT_MS,
      );
      let response: Response;
      let body: Buffer;
      let contentType: string;
      let extension: string;
      try {
        try {
          response = await fetchImpl(temporaryUrl, {
            redirect: "error",
            signal: abortController.signal,
          });
        } catch {
          throw new R2ImageError("download_failed");
        }
        if (!response.ok) throw new R2ImageError("download_failed");

        contentType =
          response.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
        extension = EXTENSIONS[contentType];
        if (!extension) throw new R2ImageError("unsupported_type");

        const declaredLength = Number(
          response.headers.get("content-length") ?? "0",
        );
        if (declaredLength > MAX_IMAGE_BYTES) {
          throw new R2ImageError("too_large");
        }

        body = await readBoundedBody(response);
        if (!matchesImageSignature(contentType, body)) {
          throw new R2ImageError("unsupported_type");
        }
      } finally {
        clearTimeout(timeout);
      }

      const objectKey = `images/${userId}/${nanoid()}.${extension}`;
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: objectKey,
            Body: body,
            ContentType: contentType,
          }),
        );
      } catch {
        throw new R2ImageError("upload_failed");
      }

      return {
        objectKey,
        permanentUrl: `${publicUrl}/${objectKey}`,
      };
    },

    async deleteObject(objectKey: string) {
      try {
        await client.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }),
        );
      } catch {
        throw new R2ImageError("delete_failed");
      }
    },
  };
}
