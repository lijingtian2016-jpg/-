/**
 * Parses the reply from the LLM to separate text content from an image generation prompt.
 * @param reply The raw reply string from the LLM.
 * @returns An object containing the clean text and the image prompt, if present.
 */
export const parseReply = (reply: string) => {
  // Matches [IMAGE: any content here]
  const imageMatch = reply.match(/\[IMAGE:\s*(.+?)\]/);

  // Removes the image tag and any surrounding whitespace
  const textContent = reply.replace(/\[IMAGE:\s*.+?\]/g, '').trim();

  return {
    text: textContent,
    imagePrompt: imageMatch ? imageMatch[1].trim() : null,
  };
};
