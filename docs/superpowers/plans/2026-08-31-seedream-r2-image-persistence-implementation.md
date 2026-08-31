# Seedream R2 Image Persistence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the mock image endpoint with an authenticated Seedream → R2 → Supabase pipeline that returns permanent image URLs.

**Architecture:** The API route authenticates and validates the request, then coordinates three focused server modules: Ark image generation, R2 image storage, and a Supabase repository. Provider temporary URLs and all credentials stay server-side; database failure triggers compensating R2 deletion.

**Tech Stack:** Next.js 14 App Router, TypeScript, Supabase Auth/Postgres/RLS, Volcengine Ark Images API, Cloudflare R2 S3 API, AWS SDK v3, nanoid, Zod, Vitest

---

## File Structure

- Modify `.env.example`: document server-only Ark and R2 variables with placeholders.
- Modify `package.json` and `pnpm-lock.yaml`: add AWS S3 client and nanoid runtime dependencies.
- Create `src/lib/image-generation/ark-image-service.ts`: call Seedream and classify upstream errors.
- Create `src/lib/image-generation/ark-image-service.test.ts`: cover request shape, success, `401`, `429`, timeout, and malformed responses.
- Create `src/lib/storage/r2-image-storage.ts`: download, validate, upload, delete, and construct public URLs.
- Create `src/lib/storage/r2-image-storage.test.ts`: cover MIME/size validation, user-scoped keys, upload, URL normalization, and cleanup.
- Create `supabase/migrations/202608310001_create_generated_images.sql`: create the table, indexes, RLS, and policies.
- Create `src/lib/image-generation/generated-image-repository.ts`: persist generated-image metadata with the session-aware Supabase client.
- Create `src/lib/image-generation/generated-image-repository.test.ts`: verify insert payload and error propagation.
- Modify `src/app/api/image/route.ts`: authenticate, validate, orchestrate, log safely, compensate, and map errors.
- Create `src/app/api/image/route.test.ts`: cover all route stages and public responses.
- Preserve `/Users/xiaodingdang/-/paper-doll-boyfriend/lib:r2.ts`: user-owned untracked source; do not edit, delete, or commit it.

### Task 1: Runtime dependencies and environment contract

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`

- [ ] **Step 1: Install server runtime dependencies**

Run:

```bash
pnpm add @aws-sdk/client-s3 nanoid
```

Expected: exit 0; both packages appear under `dependencies` and the lockfile is updated.

- [ ] **Step 2: Document exact server configuration**

Append to `.env.example`:

```dotenv
ARK_API_KEY=your-ark-api-key
ARK_IMAGE_MODEL=your-seedream-model-or-endpoint-id
ARK_IMAGE_API_URL=https://ark.cn-beijing.volces.com/api/v3/images/generations
ARK_IMAGE_TIMEOUT_MS=60000
R2_ACCESS_KEY_ID=your-r2-access-key-id
R2_SECRET_ACCESS_KEY=your-r2-secret-access-key
R2_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com
R2_BUCKET_NAME=your-r2-bucket-name
R2_PUBLIC_URL=https://your-public-r2-domain.example.com
```

No real value may be added and none of these names may use `NEXT_PUBLIC_`.

- [ ] **Step 3: Verify dependency and secret boundaries**

Run:

```bash
pnpm list @aws-sdk/client-s3 nanoid
rg -n '^(ARK_|R2_)' .env.example
git grep -n 'NEXT_PUBLIC_.*\(ARK\|R2\)' -- . ':!docs' || true
git status --short
```

Expected: dependencies are listed; nine new environment lines exist; client-variable scan returns no matches; the main worktree's untracked `lib:r2.ts` is not present or modified in this worktree.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "build: add Ark and R2 image dependencies"
```

### Task 2: Ark Seedream image service

**Files:**
- Create: `src/lib/image-generation/ark-image-service.test.ts`
- Create: `src/lib/image-generation/ark-image-service.ts`

- [ ] **Step 1: Write failing service contract tests**

Create tests using an injected `fetchImpl` and environment stubs:

```ts
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ArkImageError, generateImageWithArk } from './ark-image-service';

afterEach(() => vi.unstubAllEnvs());

function configureArk() {
  vi.stubEnv('ARK_API_KEY', 'server-key');
  vi.stubEnv('ARK_IMAGE_MODEL', 'doubao-seedream-model');
  vi.stubEnv('ARK_IMAGE_API_URL', 'https://ark.example/images/generations');
  vi.stubEnv('ARK_IMAGE_TIMEOUT_MS', '50');
}

describe('generateImageWithArk', () => {
  it('requests one URL image and returns provider metadata', async () => {
    configureArk();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ url: 'https://temporary.example/image.jpeg' }],
    }), { status: 200, headers: { 'content-type': 'application/json' } }));

    await expect(generateImageWithArk('a cinematic train', { fetchImpl })).resolves.toEqual({
      temporaryUrl: 'https://temporary.example/image.jpeg',
      provider: 'volcengine-ark',
      model: 'doubao-seedream-model',
    });

    expect(fetchImpl).toHaveBeenCalledWith(
      'https://ark.example/images/generations',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer server-key',
          'Content-Type': 'application/json',
        }),
      }),
    );
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body)).toEqual({
      model: 'doubao-seedream-model',
      prompt: 'a cinematic train',
      response_format: 'url',
      sequential_image_generation: 'disabled',
      watermark: false,
    });
  });

  it.each([
    [401, 'invalid_credentials'],
    [429, 'rate_limited'],
    [500, 'upstream_failure'],
  ] as const)('maps provider status %s', async (status, code) => {
    configureArk();
    const fetchImpl = vi.fn().mockResolvedValue(new Response('{}', { status }));
    await expect(generateImageWithArk('prompt', { fetchImpl })).rejects.toMatchObject({ code });
  });

  it('rejects a successful response without an image URL', async () => {
    configureArk();
    const fetchImpl = vi.fn().mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    await expect(generateImageWithArk('prompt', { fetchImpl })).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });

  it('maps an aborted request to timeout', async () => {
    configureArk();
    const fetchImpl = vi.fn((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')));
    }));
    await expect(generateImageWithArk('prompt', { fetchImpl })).rejects.toMatchObject({ code: 'timeout' });
  });
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm test src/lib/image-generation/ark-image-service.test.ts
```

Expected: FAIL because `ark-image-service.ts` does not exist.

- [ ] **Step 3: Implement the minimal service**

Create:

```ts
export type ArkImageErrorCode =
  | 'configuration'
  | 'invalid_credentials'
  | 'rate_limited'
  | 'timeout'
  | 'invalid_response'
  | 'upstream_failure';

export class ArkImageError extends Error {
  constructor(public readonly code: ArkImageErrorCode) {
    super(code);
    this.name = 'ArkImageError';
  }
}

interface ArkOptions { fetchImpl?: typeof fetch }

export async function generateImageWithArk(prompt: string, options: ArkOptions = {}) {
  const apiKey = process.env.ARK_API_KEY;
  const model = process.env.ARK_IMAGE_MODEL;
  const endpoint = process.env.ARK_IMAGE_API_URL
    ?? 'https://ark.cn-beijing.volces.com/api/v3/images/generations';
  const timeoutMs = Number(process.env.ARK_IMAGE_TIMEOUT_MS ?? '60000');
  if (!apiKey || !model || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ArkImageError('configuration');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await (options.fetchImpl ?? fetch)(endpoint, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        response_format: 'url',
        sequential_image_generation: 'disabled',
        watermark: false,
      }),
      signal: controller.signal,
    });
    if (response.status === 401) throw new ArkImageError('invalid_credentials');
    if (response.status === 429) throw new ArkImageError('rate_limited');
    if (!response.ok) throw new ArkImageError('upstream_failure');
    const payload = await response.json() as { data?: Array<{ url?: string }> };
    const temporaryUrl = payload.data?.[0]?.url;
    if (!temporaryUrl) throw new ArkImageError('invalid_response');
    return { temporaryUrl, provider: 'volcengine-ark' as const, model };
  } catch (error) {
    if (error instanceof ArkImageError) throw error;
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ArkImageError('timeout');
    }
    throw new ArkImageError('upstream_failure');
  } finally {
    clearTimeout(timeout);
  }
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm test src/lib/image-generation/ark-image-service.test.ts
```

Expected: all Ark service tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/image-generation/ark-image-service.ts src/lib/image-generation/ark-image-service.test.ts
git commit -m "feat: add Ark Seedream image service"
```

### Task 3: Cloudflare R2 image storage

**Files:**
- Create: `src/lib/storage/r2-image-storage.test.ts`
- Create: `src/lib/storage/r2-image-storage.ts`

- [ ] **Step 1: Write failing storage tests**

Mock AWS SDK commands and assert the public contract:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createR2ImageStorage, R2ImageError } from './r2-image-storage';

const send = vi.fn();
vi.mock('@aws-sdk/client-s3', () => ({
  S3Client: vi.fn(() => ({ send })),
  PutObjectCommand: vi.fn((input) => ({ kind: 'put', input })),
  DeleteObjectCommand: vi.fn((input) => ({ kind: 'delete', input })),
}));
vi.mock('nanoid', () => ({ nanoid: () => 'unique-id' }));

beforeEach(() => {
  send.mockReset().mockResolvedValue({});
  vi.stubEnv('R2_ACCESS_KEY_ID', 'access');
  vi.stubEnv('R2_SECRET_ACCESS_KEY', 'secret');
  vi.stubEnv('R2_ENDPOINT', 'https://account.r2.cloudflarestorage.com');
  vi.stubEnv('R2_BUCKET_NAME', 'images');
  vi.stubEnv('R2_PUBLIC_URL', 'https://cdn.example.com/');
});

it('downloads and uploads a validated user-scoped JPEG', async () => {
  const fetchImpl = vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
    status: 200,
    headers: { 'content-type': 'image/jpeg', 'content-length': '3' },
  }));
  const storage = createR2ImageStorage({ fetchImpl });
  await expect(storage.persistTemporaryImage('https://temp/image', 'user-1')).resolves.toEqual({
    objectKey: 'images/user-1/unique-id.jpeg',
    permanentUrl: 'https://cdn.example.com/images/user-1/unique-id.jpeg',
  });
  expect(send).toHaveBeenCalledWith(expect.objectContaining({
    kind: 'put',
    input: expect.objectContaining({ Key: 'images/user-1/unique-id.jpeg', ContentType: 'image/jpeg' }),
  }));
});

it.each(['text/html', 'image/svg+xml'])('rejects unsupported content type %s', async (contentType) => {
  const storage = createR2ImageStorage({
    fetchImpl: vi.fn().mockResolvedValue(new Response('bad', { headers: { 'content-type': contentType } })),
  });
  await expect(storage.persistTemporaryImage('https://temp/image', 'user-1')).rejects.toMatchObject({
    code: 'unsupported_type',
  });
  expect(send).not.toHaveBeenCalled();
});

it('rejects images larger than ten MiB', async () => {
  const storage = createR2ImageStorage({
    fetchImpl: vi.fn().mockResolvedValue(new Response(new Uint8Array(0), {
      headers: { 'content-type': 'image/png', 'content-length': String(10 * 1024 * 1024 + 1) },
    })),
  });
  await expect(storage.persistTemporaryImage('https://temp/image', 'user-1')).rejects.toMatchObject({
    code: 'too_large',
  });
});

it('deletes an uploaded object by key', async () => {
  const storage = createR2ImageStorage({ fetchImpl: vi.fn() });
  await storage.deleteObject('images/user-1/unique-id.jpeg');
  expect(send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'delete' }));
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm test src/lib/storage/r2-image-storage.test.ts
```

Expected: FAIL because the storage module does not exist.

- [ ] **Step 3: Implement download, validation, upload, and delete**

Create this module:

```ts
import { DeleteObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { nanoid } from 'nanoid';

export type R2ImageErrorCode =
  | 'configuration'
  | 'download_failed'
  | 'unsupported_type'
  | 'too_large'
  | 'upload_failed'
  | 'delete_failed';

export class R2ImageError extends Error {
  constructor(public readonly code: R2ImageErrorCode) {
    super(code);
    this.name = 'R2ImageError';
  }
}

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpeg',
  'image/webp': 'webp',
};

export function createR2ImageStorage(options: { fetchImpl?: typeof fetch } = {}) {
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const endpoint = process.env.R2_ENDPOINT;
  const bucket = process.env.R2_BUCKET_NAME;
  const publicUrl = process.env.R2_PUBLIC_URL?.replace(/\/$/, '');
  if (!accessKeyId || !secretAccessKey || !endpoint || !bucket || !publicUrl) {
    throw new R2ImageError('configuration');
  }
  const client = new S3Client({
    region: 'auto', endpoint,
    credentials: { accessKeyId, secretAccessKey },
  });
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async persistTemporaryImage(temporaryUrl: string, userId: string) {
      let response: Response;
      try {
        response = await fetchImpl(temporaryUrl);
      } catch {
        throw new R2ImageError('download_failed');
      }
      if (!response.ok) throw new R2ImageError('download_failed');
      const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
      const extension = EXTENSIONS[contentType];
      if (!extension) throw new R2ImageError('unsupported_type');
      const declaredLength = Number(response.headers.get('content-length') ?? '0');
      if (declaredLength > MAX_IMAGE_BYTES) throw new R2ImageError('too_large');
      const body = Buffer.from(await response.arrayBuffer());
      if (body.byteLength > MAX_IMAGE_BYTES) throw new R2ImageError('too_large');
      const objectKey = `images/${userId}/${nanoid()}.${extension}`;
      try {
        await client.send(new PutObjectCommand({
          Bucket: bucket, Key: objectKey, Body: body, ContentType: contentType,
        }));
      } catch {
        throw new R2ImageError('upload_failed');
      }
      return { objectKey, permanentUrl: `${publicUrl}/${objectKey}` };
    },
    async deleteObject(objectKey: string) {
      try {
        await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: objectKey }));
      } catch {
        throw new R2ImageError('delete_failed');
      }
    },
  };
}
```

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
pnpm test src/lib/storage/r2-image-storage.test.ts
```

Expected: all R2 storage tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/storage/r2-image-storage.ts src/lib/storage/r2-image-storage.test.ts
git commit -m "feat: persist generated images to R2"
```

### Task 4: Supabase table and repository

**Files:**
- Create: `supabase/migrations/202608310001_create_generated_images.sql`
- Create: `src/lib/image-generation/generated-image-repository.test.ts`
- Create: `src/lib/image-generation/generated-image-repository.ts`

- [ ] **Step 1: Write failing repository tests**

```ts
import { describe, expect, it, vi } from 'vitest';
import { createGeneratedImageRepository, GeneratedImageRepositoryError } from './generated-image-repository';

it('inserts exact generated image metadata', async () => {
  const insert = vi.fn().mockResolvedValue({ error: null });
  const from = vi.fn(() => ({ insert }));
  const repository = createGeneratedImageRepository({ from });
  const record = {
    userId: 'user-1', imageUrl: 'https://cdn/image.jpeg', objectKey: 'images/user-1/id.jpeg',
    prompt: 'prompt', provider: 'volcengine-ark', model: 'seedream-model',
  };
  await repository.insert(record);
  expect(from).toHaveBeenCalledWith('generated_images');
  expect(insert).toHaveBeenCalledWith({
    user_id: 'user-1', image_url: 'https://cdn/image.jpeg', object_key: 'images/user-1/id.jpeg',
    prompt: 'prompt', provider: 'volcengine-ark', model: 'seedream-model',
  });
});

it('wraps database errors without exposing their message', async () => {
  const repository = createGeneratedImageRepository({
    from: vi.fn(() => ({ insert: vi.fn().mockResolvedValue({ error: { message: 'database detail' } }) })),
  });
  await expect(repository.insert({
    userId: 'user-1', imageUrl: 'url', objectKey: 'key', prompt: 'prompt',
    provider: 'volcengine-ark', model: 'model',
  })).rejects.toBeInstanceOf(GeneratedImageRepositoryError);
});
```

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm test src/lib/image-generation/generated-image-repository.test.ts
```

Expected: FAIL because the repository module does not exist.

- [ ] **Step 3: Implement the repository**

Export a `GeneratedImageRecord` interface, `GeneratedImageRepositoryError`, and:

```ts
export function createGeneratedImageRepository(client: {
  from: (table: string) => { insert: (row: Record<string, string>) => Promise<{ error: unknown }> };
}) {
  return {
    async insert(record: GeneratedImageRecord) {
      const { error } = await client.from('generated_images').insert({
        user_id: record.userId,
        image_url: record.imageUrl,
        object_key: record.objectKey,
        prompt: record.prompt,
        provider: record.provider,
        model: record.model,
      });
      if (error) throw new GeneratedImageRepositoryError();
    },
  };
}
```

- [ ] **Step 4: Create the exact SQL migration**

```sql
create table public.generated_images (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  image_url text not null,
  object_key text not null unique,
  prompt text not null,
  provider text not null,
  model text not null,
  created_at timestamptz not null default now()
);

create index generated_images_user_created_idx
  on public.generated_images (user_id, created_at desc);

alter table public.generated_images enable row level security;

create policy "Users can insert their own generated images"
  on public.generated_images for insert to authenticated
  with check ((select auth.uid()) = user_id);

create policy "Users can view their own generated images"
  on public.generated_images for select to authenticated
  using ((select auth.uid()) = user_id);
```

- [ ] **Step 5: Run tests and verify GREEN**

Run:

```bash
pnpm test src/lib/image-generation/generated-image-repository.test.ts
rg -n 'enable row level security|auth.uid|for insert|for select' supabase/migrations/202608310001_create_generated_images.sql
```

Expected: repository tests pass and the migration scan shows RLS plus both ownership policies.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/202608310001_create_generated_images.sql src/lib/image-generation/generated-image-repository.ts src/lib/image-generation/generated-image-repository.test.ts
git commit -m "feat: store generated image metadata"
```

### Task 5: Authenticated image API orchestration

**Files:**
- Create: `src/app/api/image/route.test.ts`
- Modify: `src/app/api/image/route.ts`

- [ ] **Step 1: Write failing route tests with mocked boundaries**

Mock `@/lib/supabase/server`, Ark service, R2 storage, and repository. Cover:

```ts
it('rejects anonymous requests before generation', async () => {
  getUser.mockResolvedValue({ data: { user: null }, error: null });
  const response = await POST(request({ prompt: 'portrait' }));
  expect(response.status).toBe(401);
  await expect(response.json()).resolves.toEqual({ error: '请先登录' });
  expect(generateImageWithArk).not.toHaveBeenCalled();
});

it('returns only the permanent URL and persists metadata', async () => {
  getUser.mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
  generateImageWithArk.mockResolvedValue({
    temporaryUrl: 'https://temporary/signed', provider: 'volcengine-ark', model: 'seedream-model',
  });
  persistTemporaryImage.mockResolvedValue({
    objectKey: 'images/user-1/id.jpeg', permanentUrl: 'https://cdn/images/user-1/id.jpeg',
  });
  const response = await POST(request({ prompt: 'portrait' }));
  expect(response.status).toBe(200);
  await expect(response.json()).resolves.toEqual({ imageUrl: 'https://cdn/images/user-1/id.jpeg' });
  expect(insert).toHaveBeenCalledWith(expect.objectContaining({
    userId: 'user-1', imageUrl: 'https://cdn/images/user-1/id.jpeg', prompt: 'portrait',
  }));
});

it('deletes the R2 object when database persistence fails', async () => {
  insert.mockRejectedValue(new GeneratedImageRepositoryError());
  const response = await POST(request({ prompt: 'portrait' }));
  expect(deleteObject).toHaveBeenCalledWith('images/user-1/id.jpeg');
  expect(response.status).toBe(500);
  await expect(response.json()).resolves.toEqual({ error: '图片记录保存失败' });
});
```

Add table-driven cases for invalid prompt `400`, Ark invalid credentials `502`, Ark rate limit `429`, Ark timeout `504`, other Ark/download failures `502`, and R2 upload failure `502`. Assert no public payload contains the temporary URL or internal error message.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
pnpm test src/app/api/image/route.test.ts
```

Expected: FAIL because the route still returns Picsum and has no authentication or service orchestration.

- [ ] **Step 3: Implement authentication, validation, orchestration, and compensation**

Use this request schema:

```ts
const imageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
});
```

Replace the mock route with this orchestration structure:

```ts
import { nanoid } from 'nanoid';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { ArkImageError, generateImageWithArk } from '@/lib/image-generation/ark-image-service';
import {
  createGeneratedImageRepository,
  GeneratedImageRepositoryError,
} from '@/lib/image-generation/generated-image-repository';
import { createR2ImageStorage, R2ImageError } from '@/lib/storage/r2-image-storage';
import { createClient } from '@/lib/supabase/server';

const imageRequestSchema = z.object({
  prompt: z.string().trim().min(1).max(2000),
});

function publicError(error: unknown) {
  if (error instanceof ArkImageError) {
    if (error.code === 'rate_limited') return [429, '图片生成过于频繁，请稍后再试'] as const;
    if (error.code === 'timeout') return [504, '图片生成超时，请重试'] as const;
    if (error.code === 'configuration' || error.code === 'invalid_credentials') {
      return [502, '图片服务配置异常'] as const;
    }
    return [502, '图片生成失败，请重试'] as const;
  }
  if (error instanceof R2ImageError) {
    if (error.code === 'download_failed' || error.code === 'unsupported_type' || error.code === 'too_large') {
      return [502, '图片生成失败，请重试'] as const;
    }
    return [502, '图片保存失败，请重试'] as const;
  }
  if (error instanceof GeneratedImageRepositoryError) {
    return [500, '图片记录保存失败'] as const;
  }
  return [500, '图片生成失败，请重试'] as const;
}

async function logTimed<T>(
  metadata: { requestId: string; userId: string; stage: string },
  operation: () => Promise<T>,
) {
  const startedAt = Date.now();
  try {
    const result = await operation();
    console.info({ ...metadata, status: 'ok', durationMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    console.error({
      ...metadata,
      status: 'error',
      durationMs: Date.now() - startedAt,
      category: error instanceof Error ? error.name : 'UnknownError',
    });
    throw error;
  }
}

export async function POST(request: Request) {
  let parsedBody: unknown;
  try {
    parsedBody = await request.json();
  } catch {
    return NextResponse.json({ error: '请输入图片描述' }, { status: 400 });
  }
  const validation = imageRequestSchema.safeParse(parsedBody);
  if (!validation.success) {
    return NextResponse.json({ error: '请输入图片描述' }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: '请先登录' }, { status: 401 });

  const requestId = nanoid();
  const prompt = validation.data.prompt;
  const storage = createR2ImageStorage();
  let uploaded: { objectKey: string; permanentUrl: string } | null = null;
  try {
    const generated = await logTimed(
      { requestId, userId: user.id, stage: 'generate' },
      () => generateImageWithArk(prompt),
    );
    uploaded = await logTimed(
      { requestId, userId: user.id, stage: 'persist-r2' },
      () => storage.persistTemporaryImage(generated.temporaryUrl, user.id),
    );
    const repository = createGeneratedImageRepository(supabase);
    await logTimed(
      { requestId, userId: user.id, stage: 'persist-database' },
      () => repository.insert({
        userId: user.id,
        imageUrl: uploaded!.permanentUrl,
        objectKey: uploaded!.objectKey,
        prompt,
        provider: generated.provider,
        model: generated.model,
      }),
    );
    console.info({
      requestId,
      userId: user.id,
      stage: 'complete',
      status: 'ok',
      provider: generated.provider,
      model: generated.model,
      promptLength: prompt.length,
    });
    return NextResponse.json({ imageUrl: uploaded.permanentUrl });
  } catch (error) {
    if (uploaded && error instanceof GeneratedImageRepositoryError) {
      try {
        await storage.deleteObject(uploaded.objectKey);
      } catch (cleanupError) {
        console.error({
          requestId,
          userId: user.id,
          stage: 'cleanup-r2',
          status: 'error',
          category: cleanupError instanceof Error ? cleanupError.name : 'UnknownError',
        });
      }
    }
    const [status, message] = publicError(error);
    return NextResponse.json({ error: message }, { status });
  }
}
```

The code logs only the whitelisted structured fields shown above. It never logs prompt text, API keys, R2 credentials, temporary URLs, or provider response bodies.

- [ ] **Step 4: Run route tests and verify GREEN**

Run:

```bash
pnpm test src/app/api/image/route.test.ts
```

Expected: all image route tests pass.

- [ ] **Step 5: Run all image tests**

Run:

```bash
pnpm test src/app/api/image/route.test.ts src/lib/image-generation/ark-image-service.test.ts src/lib/storage/r2-image-storage.test.ts src/lib/image-generation/generated-image-repository.test.ts
```

Expected: all image pipeline tests pass with no unhandled errors.

- [ ] **Step 6: Commit**

```bash
git add src/app/api/image/route.ts src/app/api/image/route.test.ts
git commit -m "feat: generate and persist user images"
```

### Task 6: Full verification, migration application, and deployment readiness

**Files:**
- Verify: all feature files
- Verify but never commit: `.env.local`
- Preserve: `/Users/xiaodingdang/-/paper-doll-boyfriend/lib:r2.ts`

- [ ] **Step 1: Verify environment presence without values**

Run a presence-only check for:

```text
ARK_API_KEY
ARK_IMAGE_MODEL
ARK_IMAGE_API_URL
R2_ACCESS_KEY_ID
R2_SECRET_ACCESS_KEY
R2_ENDPOINT
R2_BUCKET_NAME
R2_PUBLIC_URL
```

Expected: required values report `SET`; no value is printed. If `ARK_IMAGE_MODEL` is absent, stop live verification and request the model or endpoint ID.

- [ ] **Step 2: Run complete automated verification**

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
git status --short
```

Expected: all tests pass, typecheck/build exit 0, no whitespace errors, and the feature worktree is clean.

- [ ] **Step 3: Audit secret and temporary URL boundaries**

```bash
git grep -n 'ARK_API_KEY\|R2_SECRET_ACCESS_KEY' -- src ':!**/*.test.ts' || true
git grep -n 'temporaryUrl' -- src/app src/context || true
git ls-files | rg '(^|/)\.env($|\.)' || true
```

Expected: server modules may read environment variable names, but no literal values exist; `temporaryUrl` never appears in client code or public response construction; no real env file is tracked.

- [ ] **Step 4: Apply the Supabase migration with explicit user authorization**

Apply `supabase/migrations/202608310001_create_generated_images.sql` through the user's Supabase SQL editor or configured CLI. This is an external database mutation and must not be assumed complete from a local SQL file.

Expected: table, index, RLS, and two policies exist. Verify with a logged-in session that own-row insert/select succeeds and a different user cannot read it.

- [ ] **Step 5: Perform one authorized live generation smoke test**

Start locally or use a preview deployment, log in, submit one prompt, and confirm:

```text
response URL uses R2_PUBLIC_URL
R2 contains the generated object
generated_images contains matching user_id/object_key/prompt/provider/model
Ark temporary URL is absent from API response and database
```

Do not create repeated paid images; one successful smoke test is sufficient.

- [ ] **Step 6: Verify rollback readiness**

Record the feature commit range and current production deployment ID. Confirm rollback is `git revert` plus Vercel promotion of the previous deployment. Keep the additive table and stored objects by default; deletion requires a separate reviewed migration/script.

- [ ] **Step 7: Request whole-feature review**

Review the full diff against `docs/superpowers/specs/2026-08-30-seedream-r2-image-persistence-design.md`, focusing on authentication, SSR Supabase/RLS behavior, SSRF risk in temporary URL download, memory limits, compensation cleanup, secret/log exposure, and stable error responses.

Expected: no unresolved Critical or Important findings before merge or production deployment.
