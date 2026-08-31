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

  const expectedSuffix = ".tos-cn-beijing.volces.com";
  if (!url.hostname.endsWith(expectedSuffix)) return false;

  const contentHost = url.hostname.slice(0, -expectedSuffix.length);
  return /^ark-content-generation[a-z0-9-]*$/.test(contentHost);
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

      let response: Response;
      try {
        response = await fetchImpl(temporaryUrl, { redirect: "error" });
      } catch {
        throw new R2ImageError("download_failed");
      }
      if (!response.ok) throw new R2ImageError("download_failed");

      const contentType =
        response.headers.get("content-type")?.split(";", 1)[0].trim() ?? "";
      const extension = EXTENSIONS[contentType];
      if (!extension) throw new R2ImageError("unsupported_type");

      const declaredLength = Number(
        response.headers.get("content-length") ?? "0",
      );
      if (declaredLength > MAX_IMAGE_BYTES) {
        throw new R2ImageError("too_large");
      }

      let body: Buffer;
      try {
        body = Buffer.from(await response.arrayBuffer());
      } catch {
        throw new R2ImageError("download_failed");
      }
      if (body.byteLength > MAX_IMAGE_BYTES) {
        throw new R2ImageError("too_large");
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
