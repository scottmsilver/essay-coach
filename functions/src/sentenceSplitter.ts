/**
 * AI-powered sentence splitter via Gemini 3.1 Flash Lite (free on Gemini API).
 * Falls back to the shared regex splitter on any failure.
 */

import { GoogleGenAI } from '@google/genai';
import { splitSentences } from './shared/sentenceSplitter';

export { splitSentences, splitParagraphs } from './shared/sentenceSplitter';

/** Normalize whitespace for comparison */
function normalize(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/** Extract JSON from a response that may be wrapped in markdown code fences */
function extractJson(text: string): string {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  return fenceMatch ? fenceMatch[1] : text;
}

/**
 * Split a single paragraph into sentences using Gemini 3.1 Flash Lite.
 * Returns the sentence array, or null on failure.
 */
async function splitOneParagraph(
  ai: InstanceType<typeof GoogleGenAI>,
  paragraph: string,
): Promise<string[] | null> {
  const result = await ai.models.generateContent({
    model: 'gemini-3.1-flash-lite-preview',
    contents: `Split this paragraph into its individual sentences. Return ONLY a JSON array of sentence strings. Preserve the exact original text of each sentence. Do not add, remove, or change any words.\n\n${paragraph}`,
    config: { temperature: 0, httpOptions: { timeout: 30_000 } },
  });

  const text = (result.text ?? '').trim();
  const jsonStr = extractJson(text);
  const parsed = JSON.parse(jsonStr);

  if (!Array.isArray(parsed) || !parsed.every((s: unknown) => typeof s === 'string')) {
    return null;
  }

  const filtered = parsed.filter((s: string) => s.trim().length > 0);
  const rejoined = normalize(filtered.join(' '));
  const original = normalize(paragraph);
  if (rejoined !== original) {
    return null;
  }

  return filtered;
}

/**
 * Split multiple paragraphs into sentences using Gemini 3.1 Flash Lite via the Gemini API.
 * Makes one API call per paragraph (in parallel) for reliable structured output.
 * Falls back to regex per-paragraph on any failure.
 */
export async function splitSentencesAI(
  apiKey: string,
  paragraphs: string[],
): Promise<string[][]> {
  const ai = new GoogleGenAI({ apiKey });

  const results = await Promise.allSettled(
    paragraphs.map((p) => splitOneParagraph(ai, p))
  );

  return results.map((result, i) => {
    if (result.status === 'fulfilled' && result.value) {
      return result.value;
    }
    const reason = result.status === 'rejected'
      ? (result.reason as Error).message
      : 'validation failed';
    console.warn(`Gemma split failed for paragraph ${i}, falling back to regex: ${reason}`);
    return splitSentences(paragraphs[i]);
  });
}
