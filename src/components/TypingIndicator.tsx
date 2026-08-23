'use client';

interface TypingIndicatorProps {
  characterName?: string; // Making it optional for flexibility
}

export const TypingIndicator = ({ characterName }: TypingIndicatorProps) => {
  return (
    <div className="flex items-center space-x-2 px-4 py-2">
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.3s]"></div>
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce [animation-delay:-0.15s]"></div>
      <div className="w-2 h-2 bg-gray-400 rounded-full animate-bounce"></div>
    </div>
  );
};
