'use client';

import { CharacterSelect } from '@/components/CharacterSelect';
import { ChatScreen } from '@/components/ChatScreen';
import { LoginScreen } from '@/components/LoginScreen';
import { useChat } from '@/context/ChatContext';
import { useAuth } from '@/context/AuthContext';
import { Loader2 } from 'lucide-react';

// A simple loading component for the initial auth check
const AppLoadingScreen = () => (
  <div className="flex flex-col justify-center items-center min-h-screen bg-zinc-100 dark:bg-zinc-900">
    <Loader2 className="w-12 h-12 text-pink-400 animate-spin" />
    <p className="mt-4 text-zinc-600 dark:text-zinc-400">正在进入心动空间...</p>
  </div>
);


export default function Home() {
  const { user, isLoading } = useAuth();
  const { chatState, selectCharacter } = useChat();
  const { character } = chatState;

  // 1. While checking auth state on load, show a loading screen
  if (isLoading) {
    return <AppLoadingScreen />;
  }
  
  // 2. If no user is logged in, force the Login screen
  if (!user) {
    return <LoginScreen />;
  }

  // 3. If user is logged in, show the main app content (character select or chat)
  return (
    <main>
      {character ? (
        <ChatScreen />
      ) : (
        <CharacterSelect onSelectCharacter={selectCharacter} />
      )}
    </main>
  );
}
