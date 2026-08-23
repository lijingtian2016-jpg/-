/**
 * Cleans a string of text to make it suitable for Text-to-Speech (TTS) conversion.
 * This involves removing special markers, parenthetical remarks, and other non-speech elements.
 * @param text The text to clean.
 * @returns A cleaned string ready for TTS.
 */
export const cleanTextForSpeech = (text: string): string => {
  if (!text) return '';

  return (
    text
      // Remove the custom image marker, e.g., [IMAGE: a cat sleeping]
      .replace(/\[IMAGE:.*?\]/g, '')
      // Remove text within Chinese full-width parentheses, e.g., （你好）
      .replace(/（[^）]*）/g, '')
      // Remove text within standard parentheses, e.g., (hello)
      .replace(/\([^)]*\)/g, '')
      // Remove text within square brackets, e.g., [aside]
      // Note: This is broader and comes after the specific IMAGE tag removal.
      .replace(/\[[^\]]*\]/g, '')
      // Remove specific quotation marks that might not be pronounced well.
      .replace(/[「」『』]/g, '')
      // Replace special characters that might be mispronounced with standard punctuation.
      .replace(/[~～]/g, ', ')
      // Final trim to remove any leading/trailing whitespace.
      .trim()
  );
};
