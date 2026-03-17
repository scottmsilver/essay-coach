/**
 * AI-powered sentence splitter via Gemma 3 4B (free on Gemini API).
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
 * Split multiple paragraphs into sentences using Gemma 3 4B via the Gemini API.
 * Makes a single API call for all paragraphs. Falls back to regex on any failure,
 * including if Gemma mutates the text.
 */
export async function splitSentencesAI(
  apiKey: string,
  paragraphs: string[],
): Promise<string[][]> {
  try {
    const ai = new GoogleGenAI({ apiKey });
    const numbered = paragraphs.map((p, i) => `[${i + 1}] ${p}`).join('\n\n');
    const result = await ai.models.generateContent({
      model: 'gemma-3-4b-it',
      contents: `Split each numbered paragraph into its individual sentences. Return ONLY a JSON array of arrays — one inner array of sentence strings per paragraph, in order. Preserve the exact original text of each sentence. Do not include any text before or after the JSON.\n\n${numbered}`,
      config: { httpOptions: { timeout: 30_000 } },
    });

    const text = (result.text ?? '').trim();
    const jsonStr = extractJson(text);
    const parsed = JSON.parse(jsonStr);

    if (!Array.isArray(parsed) || parsed.length !== paragraphs.length) {
      throw new Error(`Expected ${paragraphs.length} arrays, got ${Array.isArray(parsed) ? parsed.length : 'non-array'}`);
    }

    // Validate structure and text fidelity
    for (let i = 0; i < parsed.length; i++) {
      const arr = parsed[i];
      if (!Array.isArray(arr) || !arr.every((s: unknown) => typeof s === 'string')) {
        throw new Error('Invalid inner array structure');
      }
      // Filter empties and verify the sentences reconstruct the original paragraph
      parsed[i] = arr.filter((s: string) => s.trim().length > 0);
      const rejoined = normalize(parsed[i].join(' '));
      const original = normalize(paragraphs[i]);
      if (rejoined !== original) {
        throw new Error(`Paragraph ${i} text mismatch after Gemma split`);
      }
    }

    return parsed as string[][];
  } catch (err) {
    console.warn('Gemma sentence splitting failed, falling back to regex:', (err as Error).message);
    return paragraphs.map(splitSentences);
  }
}
