export function clampTwoSentences(text: string, maxChars = 400): string {
  if (!text) return "";
  
  const trimmed = text.replace(/\s+/g, " ").trim();
  const match = trimmed.match(/^(.+?[.!?])\s+(.+?[.!?])(.*)$/);
  const firstTwo = match ? `${match[1]} ${match[2]}` : trimmed;
  
  return firstTwo.length > maxChars ? firstTwo.slice(0, maxChars).trim() + "…" : firstTwo;
}
