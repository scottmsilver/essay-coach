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

export interface BuildPanelOpts {
  /**
   * When true, seats whose required env vars are missing are silently
   * omitted instead of throwing. Defaults to false: the panel is 3 seats
   * by design, and a missing var is treated as a misconfiguration, not an
   * optional feature. Only pass this when a partial panel is explicitly
   * acceptable (e.g. local smoke testing).
   */
  allowPartial?: boolean;
}

/**
 * Build the judge panel from environment variables.
 *
 * The panel is 3 seats by default (Anthropic, OpenAI, Google). Unless
 * `opts.allowPartial` is true, a missing `PANEL_OPENAI_MODEL`,
 * `PANEL_GEMINI_MODEL`, `OPENAI_API_KEY`, `GEMINI_API_KEY`, or
 * `ANTHROPIC_API_KEY` throws naming the exact missing var, rather than
 * silently yielding a smaller panel.
 *
 * - Anthropic anchor seat: model from `env.PANEL_ANTHROPIC_MODEL`
 *   (default 'claude-opus-4-8'), key from `env.ANTHROPIC_API_KEY` (required).
 * - OpenAI seat: model from `env.PANEL_OPENAI_MODEL`, key from
 *   `env.OPENAI_API_KEY`.
 * - Google seat: model from `env.PANEL_GEMINI_MODEL`, key from
 *   `env.GEMINI_API_KEY`.
 */
export function buildPanel(
  env: NodeJS.ProcessEnv = process.env,
  dims: string[] = [],
  opts: BuildPanelOpts = {}
): Judge[] {
  const { allowPartial = false } = opts;
  const judges: Judge[] = [];

  const anthropicKey = env.ANTHROPIC_API_KEY;
  if (!anthropicKey) {
    if (!allowPartial) {
      throw new Error('ANTHROPIC_API_KEY is required to build the anchor judge seat (set allowPartial to omit this seat)');
    }
  } else {
    const anthropicModel = env.PANEL_ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
    judges.push(
      makeAnthropicJudge({
        client: new Anthropic({ apiKey: anthropicKey }),
        model: anthropicModel,
        dims,
      })
    );
  }

  if (!env.PANEL_OPENAI_MODEL) {
    if (!allowPartial) {
      throw new Error('PANEL_OPENAI_MODEL is required to build the 3-judge panel (set allowPartial to omit this seat)');
    }
  } else if (!env.OPENAI_API_KEY) {
    if (!allowPartial) {
      throw new Error('OPENAI_API_KEY is required when PANEL_OPENAI_MODEL is set');
    }
  } else {
    judges.push(
      makeOpenAIJudge({
        client: new OpenAI({ apiKey: env.OPENAI_API_KEY }),
        model: env.PANEL_OPENAI_MODEL,
        dims,
      })
    );
  }

  if (!env.PANEL_GEMINI_MODEL) {
    if (!allowPartial) {
      throw new Error('PANEL_GEMINI_MODEL is required to build the 3-judge panel (set allowPartial to omit this seat)');
    }
  } else if (!env.GEMINI_API_KEY) {
    if (!allowPartial) {
      throw new Error('GEMINI_API_KEY is required when PANEL_GEMINI_MODEL is set');
    }
  } else {
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
