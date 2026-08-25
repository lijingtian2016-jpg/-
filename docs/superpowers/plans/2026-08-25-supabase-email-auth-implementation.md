# Supabase Email Authentication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the local nickname gate with real Supabase email/password registration, login, persistent cookie sessions, and logout.

**Architecture:** A small Supabase boundary under `src/lib/supabase` creates browser and server clients. `AuthContext` owns the client-side user lifecycle, while Next.js middleware refreshes auth cookies. A focused auth form handles login/register UX and shared validation helpers keep behavior independently testable.

**Tech Stack:** Next.js 14 App Router, React 18, TypeScript, Supabase Auth, `@supabase/ssr`, Vitest, React Testing Library, Tailwind CSS.

---

## File map

- Create `src/lib/auth/validation.ts`: pure login/register validation and Chinese Supabase error mapping.
- Create `src/lib/auth/validation.test.ts`: unit coverage for all validation and error branches.
- Create `src/lib/supabase/client.ts`: browser Supabase client factory.
- Create `src/lib/supabase/server.ts`: server Supabase client factory backed by Next.js cookies.
- Create `src/lib/supabase/middleware.ts`: session refresh helper.
- Create `src/middleware.ts`: Next.js middleware entry point.
- Modify `src/context/AuthContext.tsx`: replace localStorage identity with Supabase user/session lifecycle.
- Modify `src/components/LoginScreen.tsx`: implement the approved centered login/register card.
- Create `src/components/LoginScreen.test.tsx`: component behavior coverage.
- Create `src/components/LogoutButton.tsx`: shared accessible logout control.
- Create `src/components/LogoutButton.test.tsx`: logout interaction coverage.
- Modify `src/components/CharacterSelect.tsx`: render logout in the top-right corner.
- Modify `src/components/ChatScreen.tsx`: render logout in the header.
- Create `src/context/AuthContext.test.tsx`: auth lifecycle coverage.
- Create `vitest.config.ts` and `src/test/setup.ts`: test runtime.
- Modify `package.json` and `pnpm-lock.yaml`: runtime/test dependencies and test scripts.
- Create `.env.example`: document required public Supabase variables without secrets.

### Task 1: Install test and Supabase dependencies

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Create: `vitest.config.ts`
- Create: `src/test/setup.ts`

- [ ] **Step 1: Install runtime dependencies**

Run:

```bash
pnpm add @supabase/supabase-js @supabase/ssr
```

Expected: `package.json` contains both packages under `dependencies` and `pnpm-lock.yaml` is updated.

- [ ] **Step 2: Install test dependencies**

Run:

```bash
pnpm add -D vitest @vitejs/plugin-react jsdom @testing-library/react @testing-library/jest-dom @testing-library/user-event
```

Expected: all six packages appear under `devDependencies`.

- [ ] **Step 3: Add test scripts to `package.json`**

Add:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Expected scripts block:

```json
{
  "dev": "next dev",
  "build": "next build",
  "start": "next start",
  "lint": "next lint",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

- [ ] **Step 4: Create `vitest.config.ts`**

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    clearMocks: true,
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
```

- [ ] **Step 5: Create `src/test/setup.ts`**

```ts
import '@testing-library/jest-dom/vitest';
```

- [ ] **Step 6: Verify the empty test suite starts correctly**

Run: `pnpm test -- --passWithNoTests`

Expected: exit code 0 with no test failures.

- [ ] **Step 7: Commit**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/test/setup.ts
git commit -m "test: configure auth test environment"
```

### Task 2: Build validation and error mapping with TDD

**Files:**
- Create: `src/lib/auth/validation.test.ts`
- Create: `src/lib/auth/validation.ts`

- [ ] **Step 1: Write the failing validation tests**

Create `src/lib/auth/validation.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { mapAuthError, validateAuthForm } from './validation';

describe('validateAuthForm', () => {
  it('rejects an invalid email', () => {
    expect(validateAuthForm('register', 'bad-email', '12345678', '12345678'))
      .toBe('请输入有效的邮箱地址');
  });

  it('rejects passwords shorter than eight characters', () => {
    expect(validateAuthForm('login', 'user@example.com', '1234567'))
      .toBe('密码至少需要 8 位');
  });

  it('rejects mismatched confirmation in register mode', () => {
    expect(validateAuthForm('register', 'user@example.com', '12345678', '87654321'))
      .toBe('两次输入的密码不一致');
  });

  it('accepts a valid login payload', () => {
    expect(validateAuthForm('login', 'user@example.com', '12345678')).toBeNull();
  });
});

describe('mapAuthError', () => {
  it.each([
    ['Invalid login credentials', '邮箱或密码错误'],
    ['User already registered', '该邮箱已经注册，请直接登录'],
    ['Email rate limit exceeded', '操作过于频繁，请稍后再试'],
  ])('maps %s', (message, expected) => {
    expect(mapAuthError(message)).toBe(expected);
  });

  it('uses a safe fallback', () => {
    expect(mapAuthError('Unexpected upstream detail')).toBe('操作失败，请稍后重试');
  });
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run: `pnpm test src/lib/auth/validation.test.ts`

Expected: FAIL because `./validation` does not exist.

- [ ] **Step 3: Implement the minimum validation module**

Create `src/lib/auth/validation.ts`:

```ts
export type AuthMode = 'login' | 'register';

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateAuthForm(
  mode: AuthMode,
  email: string,
  password: string,
  confirmPassword = '',
): string | null {
  if (!EMAIL_PATTERN.test(email.trim())) return '请输入有效的邮箱地址';
  if (password.length < 8) return '密码至少需要 8 位';
  if (mode === 'register' && password !== confirmPassword) {
    return '两次输入的密码不一致';
  }
  return null;
}

export function mapAuthError(message: string): string {
  const normalized = message.toLowerCase();
  if (normalized.includes('invalid login credentials')) return '邮箱或密码错误';
  if (normalized.includes('already registered')) return '该邮箱已经注册，请直接登录';
  if (normalized.includes('rate limit')) return '操作过于频繁，请稍后再试';
  if (normalized.includes('password')) return '密码不符合安全要求';
  if (normalized.includes('fetch') || normalized.includes('network')) {
    return '网络异常，请稍后重试';
  }
  return '操作失败，请稍后重试';
}
```

- [ ] **Step 4: Run the tests and verify GREEN**

Run: `pnpm test src/lib/auth/validation.test.ts`

Expected: all validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/validation.ts src/lib/auth/validation.test.ts
git commit -m "feat: add authentication form validation"
```

### Task 3: Add Supabase client boundaries and cookie refresh

**Files:**
- Create: `src/lib/supabase/client.ts`
- Create: `src/lib/supabase/server.ts`
- Create: `src/lib/supabase/middleware.ts`
- Create: `src/middleware.ts`
- Create: `.env.example`

- [ ] **Step 1: Create the browser client**

Create `src/lib/supabase/client.ts`:

```ts
import { createBrowserClient } from '@supabase/ssr';

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] **Step 2: Create the server client**

Create `src/lib/supabase/server.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';

export async function createClient() {
  const cookieStore = cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // Server Components cannot always write cookies; middleware refreshes them.
          }
        },
      },
    },
  );
}
```

- [ ] **Step 3: Create the middleware helper**

Create `src/lib/supabase/middleware.ts`:

```ts
import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet) => {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );
  await supabase.auth.getUser();
  return response;
}
```

- [ ] **Step 4: Create the middleware entry point**

Create `src/middleware.ts`:

```ts
import type { NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)'],
};
```

- [ ] **Step 5: Document environment variables**

Create `.env.example`:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
```

- [ ] **Step 6: Type-check through a production build with temporary test values**

Run:

```bash
NEXT_PUBLIC_SUPABASE_URL=https://example.supabase.co NEXT_PUBLIC_SUPABASE_ANON_KEY=test-anon-key pnpm build
```

Expected: compilation and type checking complete; no Supabase network call is needed at build time.

- [ ] **Step 7: Commit**

```bash
git add src/lib/supabase src/middleware.ts .env.example
git commit -m "feat: add Supabase SSR client boundaries"
```

### Task 4: Replace localStorage auth context with Supabase auth

**Files:**
- Create: `src/context/AuthContext.test.tsx`
- Modify: `src/context/AuthContext.tsx`

- [ ] **Step 1: Write failing provider lifecycle tests**

Create `src/context/AuthContext.test.tsx` with a hoisted Supabase mock and a probe component:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext';

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
  onAuthStateChange: vi.fn(),
}));

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({ auth }),
}));

function Probe() {
  const { user, isLoading, login, register, logout } = useAuth();
  return (
    <div>
      <span>{isLoading ? 'loading' : user?.email ?? 'anonymous'}</span>
      <button onClick={() => login('user@example.com', '12345678')}>login</button>
      <button onClick={() => register('user@example.com', '12345678')}>register</button>
      <button onClick={logout}>logout</button>
    </div>
  );
}

describe('AuthProvider', () => {
  beforeEach(() => {
    auth.getUser.mockResolvedValue({ data: { user: null } });
    auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe: vi.fn() } },
    });
  });

  it('restores the current user and ends loading', async () => {
    auth.getUser.mockResolvedValue({ data: { user: { email: 'saved@example.com' } } });
    render(<AuthProvider><Probe /></AuthProvider>);
    expect(await screen.findByText('saved@example.com')).toBeInTheDocument();
  });

  it('delegates login, register, and logout to Supabase', async () => {
    auth.signInWithPassword.mockResolvedValue({ error: null });
    auth.signUp.mockResolvedValue({ error: null });
    auth.signOut.mockResolvedValue({ error: null });
    render(<AuthProvider><Probe /></AuthProvider>);
    await waitFor(() => expect(screen.getByText('anonymous')).toBeInTheDocument());
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'login' }));
    await user.click(screen.getByRole('button', { name: 'register' }));
    await user.click(screen.getByRole('button', { name: 'logout' }));
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'user@example.com', password: '12345678' });
    expect(auth.signUp).toHaveBeenCalledWith({ email: 'user@example.com', password: '12345678' });
    expect(auth.signOut).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the provider tests and verify RED**

Run: `pnpm test src/context/AuthContext.test.tsx`

Expected: FAIL because the current context exposes nickname-only login and no `register` method.

- [ ] **Step 3: Replace `AuthContext.tsx` with Supabase lifecycle methods**

Use these public types and methods:

```tsx
'use client';

import type { User } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createClient } from '@/lib/supabase/client';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => createClient(), []);
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data }) => {
      if (mounted) {
        setUser(data.user);
        setIsLoading(false);
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      setIsLoading(false);
    });
    return () => {
      mounted = false;
      data.subscription.unsubscribe();
    };
  }, [supabase]);

  const login = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }, [supabase]);

  const register = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signUp({ email, password });
    if (error) throw error;
  }, [supabase]);

  const logout = useCallback(async () => {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }, [supabase]);

  return (
    <AuthContext.Provider value={{ user, isLoading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within an AuthProvider');
  return context;
}
```

- [ ] **Step 4: Run provider tests and verify GREEN**

Run: `pnpm test src/context/AuthContext.test.tsx`

Expected: all provider tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.tsx src/context/AuthContext.test.tsx
git commit -m "feat: connect auth context to Supabase"
```

### Task 5: Implement the approved centered login/register card

**Files:**
- Create: `src/components/LoginScreen.test.tsx`
- Modify: `src/components/LoginScreen.tsx`

- [ ] **Step 1: Write failing component tests**

Create `src/components/LoginScreen.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LoginScreen } from './LoginScreen';

const auth = vi.hoisted(() => ({ login: vi.fn(), register: vi.fn() }));
vi.mock('@/context/AuthContext', () => ({ useAuth: () => auth }));

describe('LoginScreen', () => {
  it('switches between login and register modes', async () => {
    render(<LoginScreen />);
    expect(screen.getByRole('button', { name: '登录' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: '立即注册' }));
    expect(screen.getByLabelText('确认密码')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '注册' })).toBeInTheDocument();
  });

  it('shows validation errors before calling Supabase', async () => {
    render(<LoginScreen />);
    await userEvent.type(screen.getByLabelText('邮箱'), 'bad-email');
    await userEvent.type(screen.getByLabelText('密码'), '123');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(screen.getByRole('alert')).toHaveTextContent('请输入有效的邮箱地址');
    expect(auth.login).not.toHaveBeenCalled();
  });

  it('submits valid login credentials', async () => {
    auth.login.mockResolvedValue(undefined);
    render(<LoginScreen />);
    await userEvent.type(screen.getByLabelText('邮箱'), 'user@example.com');
    await userEvent.type(screen.getByLabelText('密码'), '12345678');
    await userEvent.click(screen.getByRole('button', { name: '登录' }));
    expect(auth.login).toHaveBeenCalledWith('user@example.com', '12345678');
  });
});
```

- [ ] **Step 2: Run the component tests and verify RED**

Run: `pnpm test src/components/LoginScreen.test.tsx`

Expected: FAIL because current UI has only a nickname input and no registration mode.

- [ ] **Step 3: Implement the centered auth card**

Replace the nickname-only state with `mode`, `email`, `password`, `confirmPassword`, `error`, and `isSubmitting`. Import `validateAuthForm`, `mapAuthError`, and `AuthMode` from `@/lib/auth/validation`; import `Loader2` and `Sparkles` from `lucide-react`. Use this submit function:

```tsx
const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
  event.preventDefault();
  setError(null);
  const validationError = validateAuthForm(mode, email, password, confirmPassword);
  if (validationError) {
    setError(validationError);
    return;
  }
  setIsSubmitting(true);
  try {
    if (mode === 'login') await login(email.trim(), password);
    else await register(email.trim(), password);
  } catch (caught) {
    setError(mapAuthError(caught instanceof Error ? caught.message : 'unknown'));
  } finally {
    setIsSubmitting(false);
  }
};
```

Render a `<form onSubmit={handleSubmit} noValidate>` inside `main.flex.min-h-screen.items-center.justify-center.bg-gradient-to-br.from-pink-100.via-rose-50.to-fuchsia-100.p-4`. The form card uses `w-full max-w-sm rounded-3xl bg-white/90 p-7 shadow-2xl`. Add associated labels named `邮箱`, `密码`, and conditionally `确认密码`; a `role="alert"` error paragraph; disabled fields and submit button while `isSubmitting`; and a button that toggles `mode` between `login` and `register` while clearing password, confirmation, and error state. The primary button text is `登录` or `注册`; the toggle text is `立即注册` or `返回登录`.

- [ ] **Step 4: Run component tests and verify GREEN**

Run: `pnpm test src/components/LoginScreen.test.tsx`

Expected: all login screen tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/components/LoginScreen.tsx src/components/LoginScreen.test.tsx
git commit -m "feat: add email login and registration screen"
```

### Task 6: Add shared logout controls

**Files:**
- Create: `src/components/LogoutButton.tsx`
- Create: `src/components/LogoutButton.test.tsx`
- Modify: `src/components/CharacterSelect.tsx`
- Modify: `src/components/ChatScreen.tsx`

- [ ] **Step 1: Write a failing logout interaction test**

Create `src/components/LogoutButton.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { LogoutButton } from './LogoutButton';

const logout = vi.hoisted(() => vi.fn());
vi.mock('@/context/AuthContext', () => ({ useAuth: () => ({ logout }) }));

describe('LogoutButton', () => {
  it('signs the current user out', async () => {
    logout.mockResolvedValue(undefined);
    render(<LogoutButton />);
    await userEvent.click(screen.getByRole('button', { name: '退出登录' }));
    expect(logout).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run the logout test and verify RED**

Run: `pnpm test src/components/LogoutButton.test.tsx`

Expected: FAIL because `LogoutButton.tsx` does not exist.

- [ ] **Step 3: Create a focused logout button**

Create `src/components/LogoutButton.tsx`:

```tsx
'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';

export function LogoutButton({ className = '' }: { className?: string }) {
  const { logout } = useAuth();
  const [isLoading, setIsLoading] = useState(false);

  return (
    <button
      type="button"
      aria-label="退出登录"
      disabled={isLoading}
      onClick={async () => {
        setIsLoading(true);
        try {
          await logout();
        } finally {
          setIsLoading(false);
        }
      }}
      className={`inline-flex items-center gap-2 rounded-full px-3 py-2 text-sm text-gray-600 hover:bg-white/70 disabled:opacity-50 ${className}`}
    >
      <LogOut size={18} />
      <span className="hidden sm:inline">退出</span>
    </button>
  );
}
```

- [ ] **Step 4: Run the logout test and verify GREEN**

Run: `pnpm test src/components/LogoutButton.test.tsx`

Expected: the logout interaction test passes.

- [ ] **Step 5: Add logout to character selection**

Import `LogoutButton` and add this immediately inside the root container:

```tsx
<div className="absolute right-4 top-4">
  <LogoutButton />
</div>
```

Add `relative` to the root container classes.

- [ ] **Step 6: Add logout to the chat header**

Import `LogoutButton` and add:

```tsx
<LogoutButton className="absolute right-2 text-gray-600 dark:text-gray-300" />
```

inside the existing relative header.

- [ ] **Step 7: Run all tests**

Run: `pnpm test`

Expected: all validation, provider, and login screen tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/LogoutButton.tsx src/components/LogoutButton.test.tsx src/components/CharacterSelect.tsx src/components/ChatScreen.tsx
git commit -m "feat: add logout controls"
```

### Task 7: Configure Supabase and verify the full application

**Files:**
- Modify locally only: `.env.local`
- No secret files committed.

- [ ] **Step 1: Create or select the Supabase project**

In Supabase Authentication settings:

- Enable the Email provider.
- Disable “Confirm email” for this first release.
- Add the local URL `http://localhost:3000` and Vercel preview URL to allowed redirect URLs.

Expected: email/password sign-up returns a session immediately.

- [ ] **Step 2: Add local environment variables**

Copy `.env.example` to `.env.local`, then replace both example values by copying the exact Project URL and publishable anonymous key from Supabase Project Settings → API. Do not paste either value into terminal output or commit `.env.local`.

Expected: `.env.local` remains ignored by Git.

- [ ] **Step 3: Run the full automated verification**

Run:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
```

Expected: all commands exit 0; build lists `/`, `/api/chat`, `/api/image`, and `/api/tts` successfully.

- [ ] **Step 4: Run local manual acceptance checks**

Run: `pnpm dev`

Verify in order:

1. Invalid email shows a Chinese validation error.
2. A new email can register with an 8+ character password.
3. Registration enters character selection.
4. Refresh preserves the signed-in session.
5. Logout returns to the auth card.
6. The same account can log in again.
7. Logout works from both character selection and chat headers.

- [ ] **Step 5: Confirm the worktree contains no secret file**

Run: `git status --short`

Expected: `.env.local` is absent from the output. If an acceptance check required a source correction, return to the task that owns that source file, add a failing regression test, implement the correction, rerun that task's tests, and commit the exact test and source paths there.

### Task 8: Preview deployment and production handoff

**Files:**
- No repository files unless verification reveals a defect.

- [ ] **Step 1: Add Vercel Preview environment variables**

In the existing `-zhipianren` project, add `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to Preview. Do not add a Service Role key.

- [ ] **Step 2: Deploy preview**

Run: `vercel deploy . -y`

Expected: deployment reaches `READY` and returns a preview URL.

- [ ] **Step 3: Update Supabase allowed redirect URLs**

Add the exact returned Vercel preview origin to Supabase Auth URL configuration.

- [ ] **Step 4: Execute preview acceptance checks**

Repeat the seven checks from Task 7 against the preview URL using a fresh test email.

Expected: all checks pass without browser console auth errors.

- [ ] **Step 5: Ask for explicit production approval**

Report the preview URL and acceptance results. Do not run a production deployment until the user explicitly approves it.

- [ ] **Step 6: Deploy production after approval**

First add the two public variables to Vercel Production, then run:

```bash
vercel deploy . --prod -y
```

Expected: deployment reaches `READY` and the stable production alias points to the new deployment.
