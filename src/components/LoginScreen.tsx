'use client';

import { type FormEvent, useState } from 'react';
import { Loader2, Sparkles } from 'lucide-react';

import { useAuth } from '@/context/AuthContext';
import { type AuthMode, mapAuthError, validateAuthForm } from '@/lib/auth/validation';

const inputClassName =
  'w-full rounded-xl border border-rose-200 bg-white/80 px-4 py-3 text-rose-950 outline-none transition placeholder:text-rose-300 focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-200 disabled:cursor-not-allowed disabled:opacity-60';

export const LoginScreen = () => {
  const { login, register } = useAuth();
  const [mode, setMode] = useState<AuthMode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const switchMode = () => {
    if (isSubmitting) return;
    setMode((currentMode) => (currentMode === 'login' ? 'register' : 'login'));
    setPassword('');
    setConfirmPassword('');
    setError(null);
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isSubmitting) return;

    const validationError = validateAuthForm(mode, email, password, confirmPassword);
    if (validationError) {
      setError(validationError);
      return;
    }

    setError(null);
    setIsSubmitting(true);
    try {
      if (mode === 'login') {
        await login(email.trim(), password);
      } else {
        await register(email.trim(), password);
      }
    } catch (caughtError) {
      const message = caughtError instanceof Error ? caughtError.message : '';
      setError(mapAuthError(message));
    } finally {
      setIsSubmitting(false);
    }
  };

  const isLogin = mode === 'login';
  const submitLabel = isSubmitting
    ? isLogin ? '登录中...' : '注册中...'
    : isLogin ? '登录' : '注册';

  return (
    <main className="flex min-h-screen items-center justify-center bg-gradient-to-br from-pink-100 via-rose-100 to-fuchsia-200 px-4 py-10">
      <section className="w-full max-w-sm rounded-3xl border border-white/70 bg-white/90 p-7 shadow-xl shadow-rose-200/60 backdrop-blur sm:p-9">
        <div className="mb-7 text-center">
          <div className="mb-3 flex items-center justify-center gap-2 text-rose-500">
            <Sparkles className="h-7 w-7" aria-hidden="true" />
            <h1 className="text-3xl font-bold tracking-tight text-rose-950">纸片人男友</h1>
          </div>
          <p className="text-sm leading-6 text-rose-700">
            {isLogin ? '登录账号，继续你的心动故事' : '注册账号，开启一段心动之旅'}
          </p>
        </div>

        <form className="space-y-4" noValidate onSubmit={handleSubmit}>
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-rose-900" htmlFor="email">邮箱</label>
            <input autoComplete="email" className={inputClassName} disabled={isSubmitting}
              id="email" onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com" type="email" value={email} />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-rose-900" htmlFor="password">密码</label>
            <input autoComplete={isLogin ? 'current-password' : 'new-password'}
              className={inputClassName} disabled={isSubmitting} id="password"
              onChange={(event) => setPassword(event.target.value)} placeholder="至少 8 位"
              type="password" value={password} />
          </div>

          {!isLogin && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-rose-900" htmlFor="confirm-password">确认密码</label>
              <input autoComplete="new-password" className={inputClassName}
                disabled={isSubmitting} id="confirm-password"
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="再次输入密码" type="password" value={confirmPassword} />
            </div>
          )}

          {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{error}</p>}

          <button className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-rose-500 to-fuchsia-500 px-4 py-3 font-semibold text-white shadow-md shadow-rose-200 transition hover:from-rose-600 hover:to-fuchsia-600 focus:outline-none focus:ring-2 focus:ring-fuchsia-400 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting} type="submit">
            {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />}
            {submitLabel}
          </button>

          <button className="w-full rounded-lg px-2 py-2 text-sm font-medium text-rose-700 transition hover:text-fuchsia-700 focus:outline-none focus:ring-2 focus:ring-fuchsia-300 disabled:cursor-not-allowed disabled:opacity-60"
            disabled={isSubmitting} onClick={switchMode} type="button">
            {isLogin ? '还没有账号？立即注册' : '已有账号？返回登录'}
          </button>
        </form>
      </section>
    </main>
  );
};
