'use client';

import { useState } from 'react';
import { useAuth } from '@/context/AuthContext';
import { Sparkles } from 'lucide-react';

export const LoginScreen = () => {
  const [name, setName] = useState('');
  const { login } = useAuth();

  const handleLogin = () => {
    if (name.trim()) {
      login(name.trim());
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleLogin();
    }
  };

  return (
    <div className="flex flex-col justify-center items-center min-h-screen bg-zinc-100 dark:bg-zinc-900 p-4">
      <div className="w-full max-w-sm text-center">
        <div className="flex justify-center items-center gap-2 mb-4">
          <Sparkles className="w-8 h-8 text-pink-400" />
          <h1 className="text-3xl font-bold text-zinc-800 dark:text-zinc-200">
            纸片人男友
          </h1>
        </div>
        <p className="text-zinc-600 dark:text-zinc-400 mb-8">
          输入你的昵称，开始一段心动之旅
        </p>
        
        <div className="space-y-4">
          <input
            type="text"
            placeholder="你的昵称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyPress={handleKeyPress}
            className="w-full px-4 py-3 bg-white dark:bg-zinc-800 border border-zinc-300 dark:border-zinc-700 rounded-lg focus:outline-none focus:ring-2 focus:ring-pink-400 dark:text-white transition"
          />
          <button
            onClick={handleLogin}
            disabled={!name.trim()}
            className="w-full px-4 py-3 bg-pink-500 text-white font-bold rounded-lg hover:bg-pink-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-pink-500 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            开启心动
          </button>
        </div>
      </div>
    </div>
  );
};
