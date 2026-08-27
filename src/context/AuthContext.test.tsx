import { act, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const auth = vi.hoisted(() => ({
  getUser: vi.fn(),
  onAuthStateChange: vi.fn(),
  signInWithPassword: vi.fn(),
  signUp: vi.fn(),
  signOut: vi.fn(),
}));

const createClient = vi.hoisted(() => vi.fn(() => ({ auth })));

vi.mock('@/lib/supabase/client', () => ({ createClient }));

import { AuthProvider, useAuth } from './AuthContext';

const user = { id: 'user-1', email: 'ada@example.com' } as User;
const session = { user, access_token: 'token' } as Session;
const unsubscribe = vi.fn();

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function wrapper({ children }: { children: ReactNode }) {
  return <AuthProvider>{children}</AuthProvider>;
}

describe('AuthProvider', () => {
  beforeEach(() => {
    auth.getUser.mockResolvedValue({ data: { user: null }, error: null });
    auth.onAuthStateChange.mockReturnValue({
      data: { subscription: { unsubscribe } },
    });
    auth.signInWithPassword.mockResolvedValue({ data: {}, error: null });
    auth.signUp.mockResolvedValue({ data: {}, error: null });
    auth.signOut.mockResolvedValue({ error: null });
  });

  it('restores the current user and ends loading', async () => {
    auth.getUser.mockResolvedValue({ data: { user }, error: null });

    const { result } = renderHook(() => useAuth(), { wrapper });

    expect(result.current.isLoading).toBe(true);
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBe(user);
  });

  it('ends loading when there is no current user', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('ends loading with no user when the initial request fails', async () => {
    auth.getUser.mockRejectedValue(new Error('network failure'));

    const { result } = renderHook(() => useAuth(), { wrapper });

    await waitFor(() => expect(result.current.isLoading).toBe(false));
    expect(result.current.user).toBeNull();
  });

  it('updates the user from auth changes and unsubscribes on unmount', async () => {
    const { result, unmount } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const callback = auth.onAuthStateChange.mock.calls[0][0];

    act(() => callback('SIGNED_IN', session));

    expect(result.current.user).toBe(user);
    unmount();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });

  it('ends loading when an auth change arrives before the initial request completes', () => {
    auth.getUser.mockReturnValue(new Promise(() => {}));
    const { result } = renderHook(() => useAuth(), { wrapper });
    const callback = auth.onAuthStateChange.mock.calls[0][0];

    act(() => callback('SIGNED_IN', session));

    expect(result.current.user).toBe(user);
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps a signed-in user when the initial request later returns no user', async () => {
    const initialUser = deferred<{ data: { user: User | null }; error: null }>();
    auth.getUser.mockReturnValue(initialUser.promise);
    const { result } = renderHook(() => useAuth(), { wrapper });
    const callback = auth.onAuthStateChange.mock.calls[0][0];

    act(() => callback('SIGNED_IN', session));
    await act(async () => initialUser.resolve({ data: { user: null }, error: null }));

    expect(result.current.user).toBe(user);
    expect(result.current.isLoading).toBe(false);
  });

  it('keeps an anonymous state when the initial request later returns a stale user', async () => {
    const initialUser = deferred<{ data: { user: User | null }; error: null }>();
    auth.getUser.mockReturnValue(initialUser.promise);
    const { result } = renderHook(() => useAuth(), { wrapper });
    const callback = auth.onAuthStateChange.mock.calls[0][0];

    act(() => callback('SIGNED_OUT', null));
    await act(async () => initialUser.resolve({ data: { user }, error: null }));

    expect(result.current.user).toBeNull();
    expect(result.current.isLoading).toBe(false);
  });

  it('logs in with the exact credentials', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.login('ada@example.com', 'correct horse'));

    expect(auth.signInWithPassword).toHaveBeenCalledWith({
      email: 'ada@example.com',
      password: 'correct horse',
    });
  });

  it('throws an error returned by login', async () => {
    const error = new Error('invalid credentials');
    auth.signInWithPassword.mockResolvedValue({ data: {}, error });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.login('ada@example.com', 'wrong')).rejects.toBe(error);
  });

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

  it('throws an error returned by registration', async () => {
    const error = new Error('already registered');
    auth.signUp.mockResolvedValue({ data: {}, error });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(
      result.current.register('ada@example.com', 'password', 'captcha-token'),
    ).rejects.toBe(error);
  });

  it('logs out', async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });

    await act(() => result.current.logout());

    expect(auth.signOut).toHaveBeenCalledOnce();
  });

  it('throws an error returned by logout', async () => {
    const error = new Error('sign out failed');
    auth.signOut.mockResolvedValue({ error });
    const { result } = renderHook(() => useAuth(), { wrapper });

    await expect(result.current.logout()).rejects.toBe(error);
  });
});
