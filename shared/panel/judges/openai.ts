import type OpenAI from 'openai';
import type { Judge } from '../types';
import { parseDimensional, parsePairwise } from './parse';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface OpenAIJudgeOpts {
  // Typed loosely so a mock client satisfies this for testing without
  // pulling in the full SDK class.
  client: Pick<OpenAI, 'chat'>;
  model: string;
  dims: string[];
}

async function callOpenAI<T>(
  client: Pick<OpenAI, 'chat'>,
  model: string,
  prompt: string,
  parse: (raw: string) => T,
  retries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        max_completion_tokens: 600,
        messages: [{ role: 'user', content: prompt }],
      });
      const raw = response.choices[0]?.message?.content ?? '';
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

export function makeOpenAIJudge(opts: OpenAIJudgeOpts): Judge {
  const { client, model, dims } = opts;
  return {
    id: `openai:${model}`,
    lab: 'openai',
    async judgeDimensional(prompt: string) {
      return callOpenAI(client, model, prompt, (raw) => parseDimensional(raw, dims));
    },
    async judgePairwise(prompt: string) {
      return callOpenAI(client, model, prompt, parsePairwise);
    },
  };
}
