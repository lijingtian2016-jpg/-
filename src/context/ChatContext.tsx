'use client';

import { createContext, useContext, useState, ReactNode, useCallback } from 'react';
import { Character, ChatState, Message } from '@/types/chat';
import { parseReply } from '@/utils/parseReply';

interface ChatContextType {
  chatState: ChatState;
  selectCharacter: (character: Character) => void;
  sendMessage: (content: string) => Promise<void>;
  resetChat: () => void;
}

const ChatContext = createContext<ChatContextType | undefined>(undefined);

const initialState: ChatState = {
  character: null,
  messages: [],
  isTyping: false,
  isGeneratingImage: false,
};

export const ChatProvider = ({ children }: { children: ReactNode }) => {
  const [chatState, setChatState] = useState<ChatState>(initialState);

  const selectCharacter = useCallback((character: Character) => {
    setChatState({
      ...initialState,
      character: character,
    });
  }, []);

  const resetChat = useCallback(() => {
    setChatState(initialState);
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    if (!chatState.character) return;

    const userMessage: Message = {
      id: `user-${Date.now()}`,
      role: 'user',
      type: 'text',
      content,
      timestamp: Date.now(),
    };

    // Immediately add user message to the chat
    const newMessages: Message[] = [...chatState.messages, userMessage];

    setChatState(prev => ({
      ...prev,
      messages: newMessages,
      isTyping: true,
    }));

    try {
      // 1. Get the character's text reply
      const chatResponse = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: chatState.character.id,
          systemPrompt: chatState.character.systemPrompt,
          // Send the history including the new user message
          messages: newMessages.map(({ role, content }) => ({
            role: role === 'user' ? 'user' : 'assistant',
            content,
          })),
        }),
      });

      if (!chatResponse.ok) throw new Error('Chat API call failed');
      const { reply } = await chatResponse.json();
      const { text, imagePrompt } = parseReply(reply);

      // 2. Add the character's text message to the state
      // Only add if there is text to show
      if (text) {
        const characterMessage: Message = {
          id: `char-${Date.now()}`,
          role: 'character',
          type: 'text',
          content: text,
          timestamp: Date.now(),
        };
        // Use a function for state update to get the most recent messages
        setChatState(prev => ({
          ...prev,
          messages: [...prev.messages, characterMessage],
        }));
      }

      // 3. If there's an image prompt, generate and add the image message
      if (imagePrompt) {
        setChatState(prev => ({ ...prev, isGeneratingImage: true }));
        try {
          const imageResponse = await fetch('/api/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: imagePrompt }),
          });
          if (!imageResponse.ok) throw new Error('Image API call failed');
          const { imageUrl } = await imageResponse.json();

          const imageMessage: Message = {
            id: `img-${Date.now()}`,
            role: 'character',
            type: 'image',
            content: imageUrl, // The content for an image message is the URL
            timestamp: Date.now(),
          };
          setChatState(prev => ({
            ...prev,
            messages: [...prev.messages, imageMessage],
          }));
        } catch (imageError) {
          console.error('Failed to generate image:', imageError);
          // Optionally add an error message for the image generation failure
          const imageErrorResponse: Message = {
            id: `error-img-${Date.now()}`,
            role: 'character',
            type: 'text',
            content: '哎呀，照片好像没拍好，稍后再试试？',
            timestamp: Date.now(),
          };
          setChatState(prev => ({
            ...prev,
            messages: [...prev.messages, imageErrorResponse],
          }));
        } finally {
          setChatState(prev => ({ ...prev, isGeneratingImage: false }));
        }
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      const errorResponse: Message = {
        id: `error-${Date.now()}`,
        role: 'character',
        type: 'text',
        content: '网络不太好，等一下再试试～',
        timestamp: Date.now(),
      };
      setChatState(prev => ({
        ...prev,
        messages: [...prev.messages, errorResponse],
      }));
    } finally {
      setChatState(prev => ({ ...prev, isTyping: false }));
    }
  }, [chatState.character, chatState.messages]);

  return (
    <ChatContext.Provider value={{ chatState, selectCharacter, sendMessage, resetChat }}>
      {children}
    </ChatContext.Provider>
  );
};

export const useChat = () => {
  const context = useContext(ChatContext);
  if (context === undefined) {
    throw new Error('useChat must be used within a ChatProvider');
  }
  return context;
};
