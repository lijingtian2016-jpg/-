import { NextResponse } from 'next/server';
import { z } from 'zod';

// Per spec 5.1, define the schema for the incoming request body
const chatRequestSchema = z.object({
  characterId: z.string(),
  systemPrompt: z.string(),
  messages: z.array(
    z.object({
      role: z.enum(['user', 'assistant']),
      content: z.string(),
    })
  ),
});

/**
 * Mocks a call to a Large Language Model.
 * In a real application, this would be replaced by a call to the coze-coding-dev-sdk.
 * It simulates a network delay and returns a response based on the user's last message.
 */
const mockLLMCall = async (
  messages: { role: 'user' | 'assistant'; content: string }[]
): Promise<string> => {
  // Simulate network delay
  await new Promise(resolve => setTimeout(resolve, 2500));

  const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content.toLowerCase() || '';

  // Simple keyword-based logic to return different mock responses
  if (lastUserMessage.includes('照片') || lastUserMessage.includes('自拍') || lastUserMessage.includes('看你')) {
    return '好啊，给你拍了一张～ [IMAGE: a handsome anime man with black curly hair and glasses, smiling for a selfie in a cozy, warm-lit room]';
  }
  if (lastUserMessage.includes('在干嘛')) {
     return '刚泡好一杯咖啡，准备看会儿书。 [IMAGE: a steaming cup of coffee on a wooden desk, next to an open book, with soft morning light coming from a window]';
  }
  if (lastUserMessage.includes('你好')) {
    return '你好呀！很高兴能和你聊天，今天天气真不错，不是吗？';
  }
  if (lastUserMessage.includes('伤心') || lastUserMessage.includes('难过')) {
    return '怎么了？别难过，一切都会好起来的。我在呢。';
  }

  // Default reply
  return '嗯...让我想想该怎么回复你。或者，你可以问我一些其他的事情？';
};


export async function POST(request: Request) {
  try {
    const body = await request.json();
    
    // Validate the request body against our schema
    const validation = chatRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json({ error: 'Invalid request body', details: validation.error.flatten() }, { status: 400 });
    }

    const { messages } = validation.data;
    
    // Using the mock function for now
    const reply = await mockLLMCall(messages);

    return NextResponse.json({ reply });

  } catch (error) {
    console.error('Error in /api/chat:', error);
    // As per spec 5.1: return a default reply on failure
    return NextResponse.json(
      { reply: '网络不太好，等一下再试试～' },
      { status: 500 }
    );
  }
}
