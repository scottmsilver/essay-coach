/**
 * Sentence splitter with handling for:
 * - Abbreviations (Mr., Dr., U.S.A., etc.)
 * - Decimals (3.14)
 * - Smart/curly quotes (\u201C \u201D)
 * - Ellipses (...)
 * - Periods inside closing quotes ("hello." She waved.)
 */

// Common abbreviations that end with a period but don't end a sentence
const ABBREVIATIONS = new Set([
  'mr', 'mrs', 'ms', 'dr', 'prof', 'sr', 'jr', 'st', 'rev', 'gen', 'sgt',
  'col', 'lt', 'cpl', 'pvt', 'capt', 'maj', 'cmdr', 'adm', 'gov', 'sen', 'rep',
  'vs', 'etc', 'approx', 'dept', 'est', 'vol', 'fig', 'eq',
  'inc', 'ltd', 'corp', 'co',
  'jan', 'feb', 'mar', 'apr', 'jun', 'jul', 'aug', 'sep', 'sept', 'oct', 'nov', 'dec',
  'mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun',
  'ave', 'blvd', 'rd', 'ct', 'ln', 'dr', 'mt', 'ft',
  'no', 'nos', 'dept', 'div',
  'ed', 'trans', 'illus',
  'e', 'i', // e.g., i.e.
  'al', // et al.
  'p', 'pp', 'pg', // page references
]);

/**
 * Check if a period at position `dotIdx` in `text` is likely a sentence boundary.
 */
function isSentenceEnd(text: string, dotIdx: number): boolean {
  // Must be followed by whitespace (or end) and then an uppercase letter or quote
  const after = text.slice(dotIdx + 1);

  // Closing quotes/brackets after the period are fine
  const afterQuotes = after.replace(/^[\u201D\u2019"')\]]+/, '');
  if (afterQuotes.length === 0) return true; // end of text

  // Must have whitespace after period (+ optional quotes)
  if (!/^\s/.test(afterQuotes)) return false;

  // Check what comes after the whitespace
  const nextContent = afterQuotes.trimStart();
  if (nextContent.length === 0) return true;

  // Next char should be uppercase, quote, or number to start a new sentence
  if (/^[A-Z\u201C\u201D"'(\[0-9]/.test(nextContent)) {
    // Check if the word before the period is an abbreviation
    const before = text.slice(0, dotIdx);
    const wordMatch = before.match(/(\w+)$/);
    if (wordMatch) {
      const word = wordMatch[1].toLowerCase();
      if (ABBREVIATIONS.has(word)) return false;
    }

    // Check for initials pattern: single letter before period (e.g., U.S.A.)
    if (wordMatch && wordMatch[1].length === 1) {
      // Look ahead: if next word is also a single letter + period, it's initials
      if (/^[A-Z]\./.test(nextContent)) return false;
      // Also check if this is the end of an initials sequence
      const beforeWord = before.slice(0, -(wordMatch[1].length));
      if (/[A-Z]\.\s*$/.test(beforeWord)) return false;
      // Middle initial: "Sarah J. Maas" — single letter preceded by a capitalized word (name)
      if (/[A-Z][a-z]+\s+$/.test(beforeWord)) return false;
    }

    // Check for decimal numbers: digit before period, digit after
    if (/\d$/.test(before) && /^\s*\d/.test(afterQuotes)) return false;

    return true;
  }

  return false;
}

/**
 * Split text into sentences. Handles abbreviations, smart quotes,
 * decimals, and ellipses.
 */
export function splitSentences(text: string): string[] {
  if (!text.trim()) return [];

  const sentences: string[] = [];
  let start = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];

    // Ellipsis: skip consecutive dots
    if (ch === '.' && i + 1 < text.length && text[i + 1] === '.') {
      while (i < text.length && text[i] === '.') i++;
      i--; // back up one since the for loop will advance
      // Check if this ellipsis ends a sentence
      if (isSentenceEnd(text, i)) {
        // Include any trailing closing quotes
        let end = i + 1;
        while (end < text.length && /[\u201D\u2019"')\]]/.test(text[end])) end++;
        const sent = text.slice(start, end).trim();
        if (sent) sentences.push(sent);
        start = end;
      }
      continue;
    }

    if (ch === '.' || ch === '!' || ch === '?') {
      if (isSentenceEnd(text, i)) {
        // Include trailing closing quotes/brackets
        let end = i + 1;
        while (end < text.length && /[\u201D\u2019"')\]]/.test(text[end])) end++;
        const sent = text.slice(start, end).trim();
        if (sent) sentences.push(sent);
        start = end;
      }
    }
  }

  // Remaining text
  const remaining = text.slice(start).trim();
  if (remaining) sentences.push(remaining);

  return sentences;
}

/**
 * Split essay content into paragraphs (double-newline, falling back to single-newline).
 */
export function splitParagraphs(content: string): string[] {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  if (paragraphs.length > 1) return paragraphs.map(p => p.trim());
  return content.split(/\n/).filter(p => p.trim().length > 0).map(p => p.trim());
}
