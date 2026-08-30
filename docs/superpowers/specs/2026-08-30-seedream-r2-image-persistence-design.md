# Seedream R2 Image Persistence Design

## Goal

Replace the mock `/api/image` response with a server-only image pipeline that accepts one prompt, generates one image with Volcengine Ark Seedream, persists the image to Cloudflare R2, records ownership and metadata in Supabase, and returns only the permanent R2 URL.

## Current State

- Next.js App Router and TypeScript application.
- Supabase email authentication is active.
- `/api/image` currently returns a Picsum placeholder URL.
- The chat UI already calls `/api/image` and displays its `imageUrl` response.
- R2 environment variables exist locally.
- An untracked user-owned file named `lib:r2.ts` contains an initial R2 upload helper. It must be preserved until its behavior is deliberately migrated and reviewed.
- No `generated_images` table or real image provider integration exists.

## Architecture

The synchronous server pipeline is:

```text
authenticated request
→ validate prompt
→ ArkImageService generates a temporary URL
→ R2ImageStorage downloads and validates the image
→ R2ImageStorage uploads a permanent object
→ GeneratedImageRepository inserts the record in Supabase
→ API returns the permanent R2 URL
```

Provider, storage, and database responsibilities remain in separate modules. The route coordinates them and translates internal failures to stable HTTP responses.

## Authentication and Authorization

- `/api/image` requires a valid Supabase user session.
- Anonymous requests return `401` and do not call Ark, R2, or the database.
- The server derives `user_id` from `supabase.auth.getUser()`; it never accepts a user ID from the request body.
- `generated_images` uses Row Level Security so users can insert and select only their own records.

## Ark Seedream Service

Create `src/lib/image-generation/ark-image-service.ts`.

- Endpoint: `https://ark.cn-beijing.volces.com/api/v3/images/generations`, configurable through `ARK_IMAGE_API_URL`.
- API key: `ARK_API_KEY`, server-only.
- Model: `ARK_IMAGE_MODEL`, server-only and configurable rather than hard-coded.
- Input: one validated text prompt.
- Output mode: one image with `response_format: "url"`.
- The service returns the first temporary image URL and provider/model metadata.
- A configurable timeout defaults to 60 seconds and uses `AbortController`.
- It distinguishes provider `401`, `429`, timeout, malformed/no-image response, and other upstream errors.

## R2 Image Storage

Create `src/lib/storage/r2-image-storage.ts` and migrate the useful behavior from the user-owned `lib:r2.ts` without overwriting it prematurely.

- Download the temporary Ark URL only on the server.
- Reject non-2xx downloads.
- Accept only supported image MIME types: PNG, JPEG, and WebP.
- Enforce a maximum download size before buffering.
- Store objects under `images/{userId}/{nanoid()}.{extension}`.
- Upload through the S3-compatible R2 API with the verified content type.
- Return both `objectKey` and permanent public URL.
- Provide deletion by object key for compensation when database persistence fails.
- Normalize `R2_PUBLIC_URL` to avoid duplicate slashes.

## Database Persistence

Add a Supabase migration that creates `public.generated_images`:

- `id uuid primary key default gen_random_uuid()`
- `user_id uuid not null references auth.users(id) on delete cascade`
- `image_url text not null`
- `object_key text not null unique`
- `prompt text not null`
- `provider text not null`
- `model text not null`
- `created_at timestamptz not null default now()`

Enable RLS. Authenticated users may insert rows only when `auth.uid() = user_id` and select only their own rows. The route uses the session-aware Supabase server client, so it does not need a service-role key.

Create `src/lib/image-generation/generated-image-repository.ts` for the insert operation.

## API Contract

`POST /api/image`

Request:

```json
{ "prompt": "a non-empty prompt" }
```

Success:

```json
{ "imageUrl": "https://public-r2-domain/images/user-id/object.jpeg" }
```

The response never contains Ark's temporary signed URL, an API key, an R2 credential, or internal provider payloads.

## Error Handling

| Condition | Status | Public response |
|---|---:|---|
| Invalid prompt | 400 | `请输入图片描述` |
| Missing session | 401 | `请先登录` |
| Ark credentials rejected | 502 | `图片服务配置异常` |
| Ark rate limited | 429 | `图片生成过于频繁，请稍后再试` |
| Ark timeout | 504 | `图片生成超时，请重试` |
| Ark/download malformed | 502 | `图片生成失败，请重试` |
| R2 upload failure | 502 | `图片保存失败，请重试` |
| Database failure | 500 | `图片记录保存失败` |

If R2 upload succeeds but the database insert fails, the route deletes the uploaded object before returning the database error. Cleanup failure is logged but does not expose internal details.

## Logging

Generate a request ID for each image request. Structured development logs may contain request ID, user ID, provider, model, prompt length, stage durations, status, and internal error category.

Never log the Ark key, R2 credentials, full temporary signed URL, full prompt, or provider response body.

## Configuration

Server-only variables:

```dotenv
ARK_API_KEY=
ARK_IMAGE_MODEL=
ARK_IMAGE_API_URL=https://ark.cn-beijing.volces.com/api/v3/images/generations
ARK_IMAGE_TIMEOUT_MS=60000
R2_ACCESS_KEY_ID=
R2_SECRET_ACCESS_KEY=
R2_ENDPOINT=
R2_BUCKET_NAME=
R2_PUBLIC_URL=
```

`.env.example` contains placeholders only. No variable uses the `NEXT_PUBLIC_` prefix.

## Testing

Use test-driven development for:

- Ark request headers/body and successful URL parsing.
- `401`, `429`, timeout, and malformed provider responses.
- R2 MIME validation, download limit, unique user-scoped key, upload, and deletion.
- Repository insert payload and database error propagation.
- Route authentication, validation, stage ordering, permanent URL response, and compensation cleanup.
- Confirmation that no secret is referenced from client modules.
- Existing chat image rendering and all authentication behavior remain passing.

## Rollback

- Revert the feature commits and redeploy the previous Vercel production deployment.
- The migration is additive and does not modify existing tables; keep historical rows during ordinary rollback.
- Only drop the table through a separate reviewed migration if its data is no longer required.
- R2 objects remain addressable by `object_key`; never bulk-delete automatically during code rollback.

## Acceptance Criteria

1. An authenticated user can submit one prompt and receive a permanent R2 URL.
2. The returned URL remains independent of Ark's 24-hour temporary URL.
3. The generated image row belongs to the authenticated Supabase user.
4. Anonymous requests cannot invoke generation.
5. Ark `401`, `429`, timeout, download, R2, and database failures produce the defined responses.
6. A database failure after upload triggers R2 deletion.
7. No real credentials or temporary signed URLs enter client code, Git, API responses, or logs.
8. Tests, TypeScript checks, and the production build pass.
