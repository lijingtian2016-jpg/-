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

  const handleLogout = async () => {
    if (isLoading) return;

    setIsLoading(true);
    try {
      await logout();
    } catch {
      // Keep provider details private and leave the control available for retry.
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <button
      type="button"
      aria-label="退出登录"
      className={cn(
        'p-2 rounded-full text-gray-600 hover:bg-black/10 transition-colors disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-300 dark:hover:bg-white/10',
        className,
      )}
      disabled={isLoading}
      onClick={handleLogout}
    >
      <LogOut size={20} aria-hidden="true" />
    </button>
  );
}
