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

async function callGoogle<T>(
  client: Pick<GoogleGenAI, 'models'>,
  model: string,
  prompt: string,
  parse: (raw: string) => T,
  retries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.models.generateContent({
        model,
        contents: prompt,
      });
      const raw = response.text ?? '';
      return parse(raw);
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
      return callGoogle(client, model, prompt, (raw) => parseDimensional(raw, dims));
    },
    async judgePairwise(prompt: string) {
      return callGoogle(client, model, prompt, parsePairwise);
    },
  };
}
