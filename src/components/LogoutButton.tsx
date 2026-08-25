'use client';

import { LogOut } from 'lucide-react';
import { useState } from 'react';

import { useAuth } from '@/context/AuthContext';
import { cn } from '@/lib/utils';

interface LogoutButtonProps {
  className?: string;
}

export function LogoutButton({ className }: LogoutButtonProps) {
  const { logout } = useAuth();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLogout = async () => {
    if (isLoading) return;

    setError(null);
    setIsLoading(true);
    try {
      await logout();
    } catch {
      setError('退出失败，请稍后重试');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className={cn('relative', className)}>
      <button
        type="button"
        aria-label="退出登录"
        className="p-2 rounded-full text-gray-600 hover:bg-black/10 transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/10"
        disabled={isLoading}
        onClick={handleLogout}
      >
        <LogOut size={20} aria-hidden="true" />
      </button>
      {error && (
        <p
          role="alert"
          className="absolute right-0 top-full z-10 mt-1 w-max max-w-48 rounded bg-red-50 px-2 py-1 text-xs text-red-700 shadow"
        >
          {error}
        </p>
      )}
    </div>
  );
}
