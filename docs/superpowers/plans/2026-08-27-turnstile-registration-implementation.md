# Turnstile Registration Protection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require a valid Cloudflare Turnstile token for Supabase email registration while leaving email login unchanged.

**Architecture:** `LoginScreen` renders `@marsidev/react-turnstile` only in registration mode and passes its short-lived token into `AuthContext.register`. `AuthContext` forwards the token through Supabase Auth's native `options.captchaToken`, so Supabase performs the authoritative server-side validation with the secret configured in its dashboard.

**Tech Stack:** Next.js 14, React 18, TypeScript, `@marsidev/react-turnstile`, Supabase Auth, Vitest, Testing Library, pnpm

---

## File Structure

- Modify `package.json` and `pnpm-lock.yaml`: install the Turnstile React component as a runtime dependency.
- Modify `.env.example`: document the browser-visible Turnstile site key; never add a secret key.
- Modify `src/context/AuthContext.tsx`: accept a CAPTCHA token in the registration contract and pass it to Supabase.
- Modify `src/context/AuthContext.test.tsx`: prove the token reaches `signUp` and registration errors still propagate.
- Modify `src/components/LoginScreen.tsx`: render and manage the registration-only widget, its token, reset lifecycle, and user-facing states.
- Modify `src/components/LoginScreen.test.tsx`: mock the third-party widget boundary and verify all registration interactions.
- Modify `src/lib/auth/validation.ts`: map Supabase CAPTCHA errors to a safe Chinese retry message.
- Modify `src/lib/auth/validation.test.ts`: lock the new mapping with a focused test.

### Task 1: Dependency and public configuration contract

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `.env.example`

- [ ] **Step 1: Install the Turnstile component**

Run:

```bash
pnpm add @marsidev/react-turnstile
```

Expected: exit 0; `@marsidev/react-turnstile` appears under `dependencies`, and the lockfile changes.

- [ ] **Step 2: Document only the public site key**

Append this exact line to `.env.example`:

```dotenv
NEXT_PUBLIC_TURNSTILE_SITE_KEY=your-turnstile-site-key
```

Do not add `TURNSTILE_SECRET_KEY` or any real key to Git. The secret is configured directly in Supabase Dashboard.

- [ ] **Step 3: Verify the dependency and environment template**

Run:

```bash
pnpm list @marsidev/react-turnstile
rg -n '^NEXT_PUBLIC_TURNSTILE_SITE_KEY=' .env.example
rg -n 'TURNSTILE.*SECRET|SECRET.*TURNSTILE' .env.example package.json src || true
```

Expected: the package is listed; line 3 of `.env.example` contains the site-key variable; the secret scan returns no matches.

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml .env.example
git commit -m "build: add Turnstile registration dependency"
```

### Task 2: Forward the CAPTCHA token through Supabase Auth

**Files:**
- Modify: `src/context/AuthContext.test.tsx`
- Modify: `src/context/AuthContext.tsx`

- [ ] **Step 1: Write the failing registration-token test**

Replace the existing `registers with the exact credentials` test with:

```tsx
it('registers with the exact credentials and CAPTCHA token', async () => {
  const { result } = renderHook(() => useAuth(), { wrapper });

  await act(() =>
    result.current.register('ada@example.com', 'new password', 'captcha-token'),
  );

  expect(auth.signUp).toHaveBeenCalledWith({
    email: 'ada@example.com',
    password: 'new password',
    options: { captchaToken: 'captcha-token' },
  });
});
```

Update the error-propagation call in the next test to use a token:

```tsx
await expect(
  result.current.register('ada@example.com', 'password', 'captcha-token'),
).rejects.toBe(error);
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test src/context/AuthContext.test.tsx
```

Expected: FAIL because `register` currently accepts two arguments and `signUp` receives no `options.captchaToken`.

- [ ] **Step 3: Implement the minimal registration contract**

Change the context interface to:

```tsx
register: (email: string, password: string, captchaToken: string) => Promise<void>;
```

Change the registration callback to:

```tsx
const register = useCallback(
  async (email: string, password: string, captchaToken: string) => {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { captchaToken },
    });
    if (error) throw error;
  },
  [supabase],
);
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm test src/context/AuthContext.test.tsx
```

Expected: all AuthContext tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/context/AuthContext.tsx src/context/AuthContext.test.tsx
git commit -m "feat: pass Turnstile token to Supabase registration"
```

### Task 3: Map Supabase CAPTCHA failures safely

**Files:**
- Modify: `src/lib/auth/validation.test.ts`
- Modify: `src/lib/auth/validation.ts`

- [ ] **Step 1: Write the failing error-mapping cases**

Add these rows to the `it.each` table in `mapAuthError` tests:

```tsx
['Captcha verification process failed', '人机验证失败，请重试'],
['captcha protection: request disallowed', '人机验证失败，请重试'],
```

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
pnpm test src/lib/auth/validation.test.ts
```

Expected: FAIL because CAPTCHA messages currently fall through to `操作失败，请稍后重试`.

- [ ] **Step 3: Add the minimal mapping before generic password/network checks**

Insert in `mapAuthError`:

```ts
if (normalizedMessage.includes('captcha')) {
  return '人机验证失败，请重试';
}
```

- [ ] **Step 4: Run the focused test and verify GREEN**

Run:

```bash
pnpm test src/lib/auth/validation.test.ts
```

Expected: all validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth/validation.ts src/lib/auth/validation.test.ts
git commit -m "feat: map CAPTCHA registration errors"
```

### Task 4: Add the registration-only Turnstile widget

**Files:**
- Modify: `src/components/LoginScreen.test.tsx`
- Modify: `src/components/LoginScreen.tsx`

- [ ] **Step 1: Add a controllable Turnstile test double**

Add this hoisted reset spy and mock near the existing `AuthContext` mock in `LoginScreen.test.tsx`:

```tsx
const turnstileMocks = vi.hoisted(() => ({
  reset: vi.fn(),
}));

vi.mock('@marsidev/react-turnstile', async () => {
  const React = await import('react');

  const Turnstile = React.forwardRef(function MockTurnstile(
    props: {
      siteKey: string;
      onSuccess?: (token: string) => void;
      onExpire?: () => void;
      onError?: () => void;
    },
    ref: React.ForwardedRef<{ reset: () => void }>,
  ) {
    React.useImperativeHandle(ref, () => ({ reset: turnstileMocks.reset }));

    return (
      <div data-testid="turnstile" data-site-key={props.siteKey}>
        <button type="button" onClick={() => props.onSuccess?.('captcha-token')}>solve challenge</button>
        <button type="button" onClick={() => props.onExpire?.()}>expire challenge</button>
        <button type="button" onClick={() => props.onError?.()}>fail challenge</button>
      </div>
    );
  });

  return { Turnstile };
});
```

Set the public test key in `beforeEach`:

```tsx
turnstileMocks.reset.mockReset();
vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', 'test-site-key');
```

Add `afterEach(() => vi.unstubAllEnvs())` beside cleanup.

- [ ] **Step 2: Write failing visibility and submission tests**

Add tests that assert the widget is registration-only and its token is required:

```tsx
it('shows Turnstile only for registration and requires a solved challenge', async () => {
  const user = userEvent.setup();
  render(<LoginScreen />);

  expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));

  expect(screen.getByTestId('turnstile')).toHaveAttribute('data-site-key', 'test-site-key');
  expect(screen.getByRole('button', { name: '注册' })).toBeDisabled();

  await user.click(screen.getByRole('button', { name: 'solve challenge' }));
  expect(screen.getByRole('button', { name: '注册' })).toBeEnabled();
});

it('passes the Turnstile token into registration', async () => {
  const user = userEvent.setup();
  authMocks.register.mockResolvedValue(undefined);
  render(<LoginScreen />);

  await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
  await user.type(screen.getByLabelText('邮箱'), '  person@example.com  ');
  await user.type(screen.getByLabelText('密码'), ' password123 ');
  await user.type(screen.getByLabelText('确认密码'), ' password123 ');
  await user.click(screen.getByRole('button', { name: 'solve challenge' }));
  await user.click(screen.getByRole('button', { name: '注册' }));

  expect(authMocks.register).toHaveBeenCalledWith(
    'person@example.com',
    ' password123 ',
    'captcha-token',
  );
});
```

Update these existing tests to click `solve challenge` after switching to registration and before clicking `注册`:

```text
rejects mismatched passwords during registration
registers with the trimmed email and exact password
```

- [ ] **Step 3: Write failing expiry, widget-error, and missing-config tests**

Add:

```tsx
it.each([
  ['expire challenge', '验证已失效，请重试'],
  ['fail challenge', '验证失败，请重试'],
])('clears verification when the widget reports %s', async (control, message) => {
  const user = userEvent.setup();
  render(<LoginScreen />);

  await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
  await user.click(screen.getByRole('button', { name: 'solve challenge' }));
  await user.click(screen.getByRole('button', { name: control }));

  expect(screen.getByRole('alert')).toHaveTextContent(message);
  expect(screen.getByRole('button', { name: '注册' })).toBeDisabled();
});

it('blocks registration when the public site key is missing', async () => {
  vi.stubEnv('NEXT_PUBLIC_TURNSTILE_SITE_KEY', '');
  const user = userEvent.setup();
  render(<LoginScreen />);

  await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));

  expect(screen.getByRole('alert')).toHaveTextContent('人机验证暂不可用，请稍后重试');
  expect(screen.getByRole('button', { name: '注册' })).toBeDisabled();
  expect(screen.queryByTestId('turnstile')).not.toBeInTheDocument();
});

it('clears the single-use token and resets the widget after registration', async () => {
  const user = userEvent.setup();
  authMocks.register.mockResolvedValue(undefined);
  render(<LoginScreen />);

  await user.click(screen.getByRole('button', { name: '还没有账号？立即注册' }));
  await user.type(screen.getByLabelText('邮箱'), 'person@example.com');
  await user.type(screen.getByLabelText('密码'), 'password123');
  await user.type(screen.getByLabelText('确认密码'), 'password123');
  await user.click(screen.getByRole('button', { name: 'solve challenge' }));
  await user.click(screen.getByRole('button', { name: '注册' }));

  expect(turnstileMocks.reset).toHaveBeenCalled();
  expect(screen.getByRole('button', { name: '注册' })).toBeDisabled();
});
```

- [ ] **Step 4: Run the component tests and verify RED**

Run:

```bash
pnpm test src/components/LoginScreen.test.tsx
```

Expected: FAIL because the widget, token state, callbacks, and three-argument registration call do not exist.

- [ ] **Step 5: Implement the minimal widget state and callbacks**

Update imports:

```tsx
import { Turnstile, type TurnstileInstance } from '@marsidev/react-turnstile';
import { type FormEvent, useRef, useState } from 'react';
```

Add state and configuration inside `LoginScreen`:

```tsx
const turnstileRef = useRef<TurnstileInstance | null>(null);
const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
const turnstileSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';
```

In `switchMode`, also clear verification state:

```tsx
setTurnstileToken(null);
turnstileRef.current?.reset();
```

Before entering the registration `try` branch, guard the token:

```tsx
if (mode === 'register' && !turnstileToken) {
  setError('请完成人机验证');
  return;
}
```

Pass the token and reset it after the registration attempt:

```tsx
} else {
  await register(email.trim(), password, turnstileToken!);
}
```

In `finally`, reset only for registration:

```tsx
if (mode === 'register') {
  setTurnstileToken(null);
  turnstileRef.current?.reset();
}
setIsSubmitting(false);
```

Render immediately above the submit button:

```tsx
{!isLogin && (
  turnstileSiteKey ? (
    <div className="flex justify-center overflow-hidden rounded-xl">
      <Turnstile
        ref={turnstileRef}
        siteKey={turnstileSiteKey}
        options={{ language: 'zh-CN', size: 'flexible', theme: 'light' }}
        onSuccess={(token) => {
          setTurnstileToken(token);
          setError(null);
        }}
        onExpire={() => {
          setTurnstileToken(null);
          setError('验证已失效，请重试');
        }}
        onError={() => {
          setTurnstileToken(null);
          setError('验证失败，请重试');
        }}
      />
    </div>
  ) : (
    <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">
      人机验证暂不可用，请稍后重试
    </p>
  )
)}
```

Extend the submit button's disabled condition:

```tsx
disabled={isSubmitting || (!isLogin && (!turnstileToken || !turnstileSiteKey))}
```

- [ ] **Step 6: Run the component tests and verify GREEN**

Run:

```bash
pnpm test src/components/LoginScreen.test.tsx
```

Expected: all LoginScreen tests pass with no unhandled warnings.

- [ ] **Step 7: Run all auth-focused tests**

Run:

```bash
pnpm test src/components/LoginScreen.test.tsx src/context/AuthContext.test.tsx src/lib/auth/validation.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 8: Commit**

```bash
git add src/components/LoginScreen.tsx src/components/LoginScreen.test.tsx
git commit -m "feat: require Turnstile for registration"
```

### Task 5: Full verification and deployment readiness

**Files:**
- Verify: all changed files
- Verify locally: `.env.local` (ignored, never committed)

- [ ] **Step 1: Confirm key boundaries without printing values**

Run:

```bash
awk -F= '/^NEXT_PUBLIC_TURNSTILE_SITE_KEY=/{print "SITE_KEY=" (length($2)>0?"SET":"EMPTY")} /^TURNSTILE_SECRET_KEY=/{print "LOCAL_SECRET=" (length($2)>0?"SET":"EMPTY")}' .env.local
git check-ignore .env.local
git grep -n 'TURNSTILE_SECRET_KEY' -- ':!docs/superpowers/specs/*' ':!docs/superpowers/plans/*' || true
```

Expected: `SITE_KEY=SET`; `.env.local` is ignored; production source contains no secret-key reference. A locally stored secret may exist, but it is not required by this implementation and must not be exposed.

- [ ] **Step 2: Run the full automated verification**

Run:

```bash
pnpm test
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: all tests pass, TypeScript emits no diagnostics, Next.js build exits 0, and Git reports no whitespace errors.

- [ ] **Step 3: Verify Supabase dashboard configuration with the user**

Confirm the user has configured:

```text
Supabase Dashboard
→ Authentication
→ Bot and Abuse Protection
→ Enable CAPTCHA protection
→ Provider: Cloudflare Turnstile
→ Secret key: the private Cloudflare Turnstile secret
```

Expected: CAPTCHA protection is enabled before live registration testing. Do not request that the secret be pasted into chat.

- [ ] **Step 4: Verify Cloudflare hostname and Vercel environment readiness**

Confirm the Turnstile widget allows the production hostname and that Vercel Production contains:

```text
NEXT_PUBLIC_TURNSTILE_SITE_KEY
```

Expected: the public key is present in Vercel; the secret is present only in Supabase; the production hostname is allowed by Cloudflare.

- [ ] **Step 5: Commit any final test-only correction, otherwise keep the tree clean**

If verification required no code correction, run:

```bash
git status --short
```

Expected: no output.

If a correction was required, first reproduce it with a failing test, make the minimum fix, rerun Step 2, then commit only those files with a precise `fix:` message.

- [ ] **Step 6: Request whole-feature review before integration**

Review the complete branch diff against `docs/superpowers/specs/2026-08-27-turnstile-registration-design.md`, with particular attention to token single-use behavior, missing-key fail-closed behavior, secret exposure, login regressions, and Supabase `captchaToken` forwarding.

Expected: no unresolved Critical or Important findings before merge or deployment.
