'use client';

import { useChat } from '@/context/ChatContext';
import { ArrowLeft, Send } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { useState, useRef, useEffect } from 'react';
import { TypingIndicator } from './TypingIndicator';
import { LogoutButton } from './LogoutButton';

export const ChatScreen = () => {
  const { chatState, sendMessage, resetChat } = useChat();
  const { character, messages, isTyping } = chatState;
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to the latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isTyping]);

  const handleSend = () => {
    if (input.trim()) {
      sendMessage(input.trim());
      setInput('');
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      handleSend();
    }
  };

  // This should ideally not happen as Home page handles it, but it's good practice
  if (!character) {
    return (
      <div className="flex flex-col gap-4 justify-center items-center min-h-screen">
        <p className="text-lg">出现错误：未选择角色。</p>
        <button onClick={resetChat} className="px-4 py-2 bg-indigo-500 text-white rounded-lg">返回重试</button>
      </div>
    );
  }

  return (
    <div className="flex justify-center items-center min-h-screen bg-zinc-100 dark:bg-zinc-900 font-sans">
      <div className="w-full max-w-md h-[95vh] flex flex-col bg-[#EDEDED] dark:bg-zinc-800 rounded-2xl shadow-2xl border border-gray-200 dark:border-zinc-700">
        <header className="relative flex items-center justify-center p-3 border-b border-gray-200 dark:border-zinc-700">
          <button onClick={resetChat} className="absolute left-3 p-2 rounded-full hover:bg-gray-200 dark:hover:bg-zinc-700 transition-colors">
            <ArrowLeft size={20} className="text-gray-600 dark:text-gray-300" />
          </button>
          <div className="text-center">
            <h2 className="text-base font-semibold text-black dark:text-white">{character.name}</h2>
            <p className="text-xs text-green-600">{isTyping ? '正在输入...' : '在线'}</p>
          </div>
          <LogoutButton className="absolute right-3" />
        </header>

        <main className="flex-1 p-4 overflow-y-auto">
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} characterAvatar={character.avatar} />
          ))}
          {isTyping && <TypingIndicator characterName={character.name} />}
          <div ref={messagesEndRef} />
        </main>

        <footer className="p-3 border-t border-gray-200 dark:border-zinc-700 bg-gray-100 dark:bg-zinc-900/50">
          <div className="flex items-center space-x-2">
            <input
              type="text"
              placeholder="输入消息..."
              className="flex-1 px-4 py-2 bg-white dark:bg-zinc-700 border border-gray-300 dark:border-zinc-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 dark:text-white transition-shadow"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyPress={handleKeyPress}
              disabled={isTyping}
            />
            <button 
              className="px-4 py-2 bg-green-500 text-white font-semibold rounded-lg hover:bg-green-600 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 transition-colors shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleSend}
              disabled={!input.trim() || isTyping}
            >
              <Send size={20} />
            </button>
          </div>
        </footer>
      </div>
    </div>
  );
};
