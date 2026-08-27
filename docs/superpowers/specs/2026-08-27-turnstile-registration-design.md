# Turnstile Registration Protection Design

## Goal

Protect email registration from automated abuse with Cloudflare Turnstile while leaving email login unchanged. Verification must be enforced by Supabase Auth, not only displayed in the browser.

## Selected Approach

Use Supabase Auth's native CAPTCHA integration for Cloudflare Turnstile.

The registration screen renders `@marsidev/react-turnstile` and receives a short-lived token. Registration passes that token to `supabase.auth.signUp` as `options.captchaToken`. Supabase validates the token using the Turnstile secret configured in the Supabase dashboard.

This avoids a custom registration API, keeps the existing Supabase session lifecycle intact, and prevents callers from bypassing a Next.js-only verification endpoint.

## User Experience

- Show Turnstile only in registration mode, directly above the registration button.
- Keep login unchanged and do not require a challenge for login.
- Disable registration until Turnstile returns a token.
- If the user submits without a usable token, show `请完成人机验证`.
- If the token expires, clear it and show `验证已失效，请重试`.
- If the widget reports an error, clear the token and show `验证失败，请重试`.
- Reset the widget token after every registration attempt because Turnstile tokens are single-use.
- Switching between login and registration clears Turnstile state and authentication errors.

## Components and Data Flow

### `LoginScreen`

- Owns `turnstileToken` state and a Turnstile widget ref/reset mechanism.
- Renders the widget only when `mode === 'register'`.
- Passes the token to `register(email, password, turnstileToken)`.
- Handles success, expiry, and widget failure callbacks without exposing provider details.

### `AuthContext`

- Changes the registration contract to `register(email, password, captchaToken)`.
- Calls `supabase.auth.signUp({ email, password, options: { captchaToken } })`.
- Leaves login, logout, initial session loading, and auth-state synchronization unchanged.

### Configuration

- Add `@marsidev/react-turnstile` as a production dependency.
- Add `NEXT_PUBLIC_TURNSTILE_SITE_KEY` to `.env.example`.
- The Turnstile site key is public and is read by the browser component.
- The Turnstile secret must remain server-side and be configured in Supabase Dashboard under Authentication → Bot and Abuse Protection → CAPTCHA. It must never use a `NEXT_PUBLIC_` variable.
- Vercel Production must contain `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.

## Error Handling

- Missing site key is treated as a configuration error and must not silently allow registration.
- Missing, expired, or failed CAPTCHA state blocks registration with a concise Chinese message.
- Supabase CAPTCHA failures are mapped to a user-safe verification retry message.
- Provider error payloads, tokens, and secret values are never rendered or logged.

## Testing

Use test-driven development and add coverage for:

- Turnstile is absent in login mode and present in registration mode.
- Registration is disabled before token success and enabled afterward.
- Successful token is passed into the registration function.
- Expiry and widget errors clear the token and show the expected message.
- Registration attempts reset the token/widget.
- `AuthContext.register` passes `options.captchaToken` to Supabase.
- Existing login, registration validation, logout, session, typecheck, and production build tests continue to pass.

## Out of Scope

- CAPTCHA for login or password reset.
- A custom Next.js registration endpoint or direct Cloudflare Siteverify implementation.
- Rate limiting, IP reputation rules, or broader API authorization.
- Visual redesign of the authentication card beyond fitting the widget responsively.

## Acceptance Criteria

1. Login works exactly as before without Turnstile.
2. Registration cannot be submitted until Turnstile succeeds.
3. Supabase receives the token through `options.captchaToken` and enforces CAPTCHA server-side.
4. Expired, failed, and reused tokens produce recoverable user-facing errors.
5. No Turnstile secret is included in client code, Git, logs, or browser-visible environment variables.
6. Tests, TypeScript checks, and the production build pass.
