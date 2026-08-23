'use client';

import { Message } from '@/types/chat';
import { cn } from '@/lib/utils';
import Image from 'next/image';

// As per spec 6.2: User avatar is a simple blue circle with "我"
const UserAvatar = () => (
  <div className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white font-bold shrink-0">
    我
  </div>
);

interface MessageBubbleProps {
  message: Message;
  characterAvatar: string;
}

export const MessageBubble = ({ message, characterAvatar }: MessageBubbleProps) => {
  const isUser = message.role === 'user';

  // Base classes for all bubbles
  const bubbleBaseClasses = 'px-3 py-2 rounded-xl max-w-[80%] shadow-sm';

  // Conditional classes for user vs. character
  const bubbleConditionalClasses = isUser
    ? 'bg-[#95EC69] dark:bg-green-800 text-black rounded-br-none' // User message styles
    : 'bg-white dark:bg-zinc-700 text-black dark:text-white rounded-bl-none'; // Character message styles

  return (
    <div className={cn('flex items-end w-full gap-2 my-2', isUser && 'justify-end')}>
      {/* Character Avatar (shown on the left) */}
      {!isUser && (
        <div className="relative w-10 h-10 shrink-0">
          <Image
            src={characterAvatar}
            alt="Character Avatar"
            layout="fill"
            objectFit="cover"
            className="rounded-full"
            unoptimized
          />
        </div>
      )}

      <div className={cn(bubbleBaseClasses, bubbleConditionalClasses, message.type === 'image' && 'p-0 bg-transparent')}>
        {message.type === 'text' && (
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{message.content}</p>
        )}
        {message.type === 'image' && message.content && (
           <div className="relative w-64 h-64 cursor-pointer" onClick={() => window.open(message.content, '_blank')}>
            <Image
              src={message.content}
              alt="Generated image from character"
              layout="fill"
              objectFit="cover"
              className="rounded-lg"
              unoptimized // Using this because the image source is external
            />
          </div>
        )}
      </div>

      {/* User Avatar (shown on the right) */}
      {isUser && <UserAvatar />}
    </div>
  );
};
