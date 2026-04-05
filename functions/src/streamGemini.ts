import { GoogleGenAI } from '@google/genai';
import type { DocumentReference } from 'firebase-admin/firestore';

const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const PROGRESS_THROTTLE_MS = 2000;

interface StreamOptions {
  apiKey: string;
  contents: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  progressRef?: DocumentReference;
  /** Firestore field name for status updates (e.g. 'evaluationStatus') */
  statusField: string;
  /** Message shown when Gemini starts writing output */
  generatingMessage: string;
  /** Gemini model to use (defaults to gemini-3.1-pro-preview) */
  model?: string;
}

/**
 * Stream a JSON response from Gemini with thinking/progress support.
 * Used by evaluation, grammar, and transition analysis.
 */
export async function streamGeminiJson(opts: StreamOptions): Promise<string> {
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });

  const stream = await ai.models.generateContentStream({
    model: opts.model ?? DEFAULT_MODEL,
    contents: opts.contents,
    config: {
      systemInstruction: opts.systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: opts.responseSchema,
      thinkingConfig: { includeThoughts: true },
    },
  });

  let outputText = '';
  let stage: 'thinking' | 'generating' = 'thinking';
  let lastProgressWrite = 0;

  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.thought) {
        if (opts.progressRef) {
          const now = Date.now();
          if (now - lastProgressWrite >= PROGRESS_THROTTLE_MS) {
            const lines = (part.text || '').trim().split('\n');
            const headline = lines[0]?.replace(/^\*+|\*+$/g, '').trim() || 'Thinking...';
            await opts.progressRef.update({ [opts.statusField]: { stage: 'thinking', message: headline } });
            lastProgressWrite = now;
          }
        }
      } else {
        if (stage === 'thinking') {
          stage = 'generating';
          if (opts.progressRef) {
            await opts.progressRef.update({ [opts.statusField]: { stage: 'generating', message: opts.generatingMessage } });
          }
        }
        outputText += part.text || '';
      }
    }
  }

  if (!outputText) {
    throw new Error('Gemini returned an empty response');
  }

  return outputText;
}
