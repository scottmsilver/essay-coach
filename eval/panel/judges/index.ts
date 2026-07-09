import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { GoogleGenAI } from '@google/genai';
import type { Judge } from '../types';
import { makeAnthropicJudge } from './anthropic';
import { makeOpenAIJudge } from './openai';
import { makeGoogleJudge } from './google';

export { makeAnthropicJudge } from './anthropic';
export { makeOpenAIJudge } from './openai';
export { makeGoogleJudge } from './google';
export { parseDimensional, parsePairwise } from './parse';

const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-4-8';

/**
 * Build the judge panel from environment variables.
 *
 * - Anthropic anchor seat: always included. Model from `env.PANEL_ANTHROPIC_MODEL`
 *   (default 'claude-opus-4-8'), key from `env.ANTHROPIC_API_KEY` (required).
 * - OpenAI seat: included only if `env.PANEL_OPENAI_MODEL` is set; requires
 *   `env.OPENAI_API_KEY`.
 * - Google seat: included only if `env.PANEL_GEMINI_MODEL` is set; requires
 *   `env.GEMINI_API_KEY`.
 */
export function buildPanel(env: NodeJS.ProcessEnv = process.env, dims: string[] = []): Judge[] {
  const judges: Judge[] = [];

  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    throw new Error('ANTHROPIC_API_KEY is required to build the anchor judge seat');
  }
  const anthropicModel = env.PANEL_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
  judges.push(
    makeAnthropicJudge({
      client: new Anthropic({ apiKey: anthropicKey }),
      model: anthropicModel,
      dims,
    })
  );

  if (env.PANEL_OPENAI_MODEL) {
    if (!env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY is required when PANEL_OPENAI_MODEL is set');
    }
    judges.push(
      makeOpenAIJudge({
        client: new OpenAI({ apiKey: env.OPENAI_API_KEY }),
        model: env.PANEL_OPENAI_MODEL,
        dims,
      })
    );
  }

  if (env.PANEL_GEMINI_MODEL) {
    if (!env.GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is required when PANEL_GEMINI_MODEL is set');
    }
    judges.push(
      makeGoogleJudge({
        client: new GoogleGenAI({ apiKey: env.GEMINI_API_KEY }),
        model: env.PANEL_GEMINI_MODEL,
        dims,
      })
    );
  }

  return judges;
}
