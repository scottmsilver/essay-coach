import type { GoogleGenAI } from '@google/genai';
import type { Judge } from '../types';
import { parseDimensional, parsePairwise } from './parse';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface GoogleJudgeOpts {
  // Typed loosely so a mock client satisfies this for testing without
  // pulling in the full SDK class.
  client: Pick<GoogleGenAI, 'models'>;
  model: string;
  dims: string[];
}

async function callGoogle(client: Pick<GoogleGenAI, 'models'>, model: string, prompt: string, retries = 3): Promise<string> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
      });
      return response.text ?? '';
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * Math.pow(2, attempt)); // 1s, 2s, 4s
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

export function makeGoogleJudge(opts: GoogleJudgeOpts): Judge {
  const { client, model, dims } = opts;
  return {
    id: `google:${model}`,
    lab: 'google',
    async judgeDimensional(prompt: string) {
      const raw = await callGoogle(client, model, prompt);
      return parseDimensional(raw, dims);
    },
    async judgePairwise(prompt: string) {
      const raw = await callGoogle(client, model, prompt);
      return parsePairwise(raw);
    },
  };
}
