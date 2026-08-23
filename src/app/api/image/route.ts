
import { NextResponse } from 'next/server';
import { z } from 'zod';

// Define the schema for the request body
const imageRequestSchema = z.object({
  prompt: z.string().min(1, 'Prompt cannot be empty'),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();

    // Validate request body
    const validation = imageRequestSchema.safeParse(body);
    if (!validation.success) {
      return NextResponse.json(
        { error: validation.error.flatten().fieldErrors },
        { status: 400 }
      );
    }

    const { prompt } = validation.data;

    // --- Mock Image Generation ---
    // In a real application, you would call your image generation service here.
    // For example:
    // const image = await coze.image({ prompt });
    // const imageUrl = await saveImageAndGetURL(image);

    // Simulate network delay
    await new Promise(resolve => setTimeout(resolve, 1500));

    // For this mock, we'll return a dynamic placeholder image.
    // We use a seed based on the current time to get different images.
    const mockImageUrl = `https://picsum.photos/seed/${Date.now()}/512/512`;

    return NextResponse.json({ imageUrl: mockImageUrl });
    // --- End Mock ---

  } catch (error) {
    console.error('Image API error:', error);
    return NextResponse.json(
      { error: 'An internal server error occurred.' },
      { status: 500 }
    );
  }
}
