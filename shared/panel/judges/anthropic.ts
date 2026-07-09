import type Anthropic from '@anthropic-ai/sdk';
import type { Judge } from '../types';
import { parseDimensional, parsePairwise } from './parse';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export interface AnthropicJudgeOpts {
  // Typed loosely so a mock client (e.g. `{ messages: { create: vi.fn() } }`)
  // satisfies this for testing without pulling in the full SDK class.
  client: Pick<Anthropic, 'messages'>;
  model: string;
  dims: string[];
}

async function callAnthropic<T>(
  client: Pick<Anthropic, 'messages'>,
  model: string,
  prompt: string,
  parse: (raw: string) => T,
  retries = 3
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await client.messages.create({
        model,
        max_tokens: 600,
        // No temperature — rejected with a 400 on this model family.
        output_config: { effort: 'low' },
        messages: [{ role: 'user', content: prompt }],
      } as Anthropic.MessageCreateParamsNonStreaming);
      const block = response.content[0];
      const raw = block && block.type === 'text' ? block.text : '';
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

export function makeAnthropicJudge(opts: AnthropicJudgeOpts): Judge {
  const { client, model, dims } = opts;
  return {
    id: `anthropic:${model}`,
    lab: 'anthropic',
    async judgeDimensional(prompt: string) {
      return callAnthropic(client, model, prompt, (raw) => parseDimensional(raw, dims));
    },
    async judgePairwise(prompt: string) {
      return callAnthropic(client, model, prompt, parsePairwise);
    },
  };
}
