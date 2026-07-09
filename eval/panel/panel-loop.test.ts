import { describe, it, expect, vi } from 'vitest';
import { runLoop } from './panel-loop';
import type { Judge } from '../../shared/panel/types';

describe('runLoop', () => {
  it('ranks a clearly-better variant above a clearly-worse one', async () => {
    // A single deterministic judge whose verdict depends on which variant's
    // feedback text appears in the prompt, so "good-variant" always beats
    // the shared baseline and "bad-variant" always loses to it.
    const judge: Judge = {
      id: 'content-judge',
      lab: 'anthropic',
      judgeDimensional: vi.fn(async (prompt: string) => {
        let score = 3;
        if (prompt.includes('GOOD_VARIANT_FEEDBACK')) score = 5;
        if (prompt.includes('BAD_VARIANT_FEEDBACK')) score = 1;
        return {
          dimensions: {
            correctness: { score, rationale: '' },
            coverage: { score, rationale: '' },
            falsePositiveRestraint: { score, rationale: '' },
            fixGuidance: { score, rationale: '' },
          },
        };
      }),
      // judgePairwise's winner is POSITIONAL (slot A = first-listed text, slot
      // B = second-listed), not tied to content identity — runItem calls it
      // once in AB order and once in BA order, so "good variant" must win
      // whichever slot it lands in, and likewise for "bad variant" losing.
      judgePairwise: vi.fn(async (prompt: string) => {
        const markerIdx = prompt.indexOf('--- FEEDBACK B ---');
        const goodIdx = prompt.indexOf('GOOD_VARIANT_FEEDBACK');
        const badIdx = prompt.indexOf('BAD_VARIANT_FEEDBACK');
        if (goodIdx !== -1) return { winner: goodIdx < markerIdx ? ('A' as const) : ('B' as const), rationale: '' };
        if (badIdx !== -1) return { winner: badIdx < markerIdx ? ('B' as const) : ('A' as const), rationale: '' };
        return { winner: 'tie' as const, rationale: '' };
      }),
    };

    const out = await runLoop({
      report: 'grammar',
      judges: [judge],
      baseline: { feedback: 'BASELINE_FEEDBACK', annotations: '[]' },
      variants: [
        {
          variantId: 'good-variant',
          items: [
            { id: 'i1', essay: 'E1', feedback: { feedback: 'GOOD_VARIANT_FEEDBACK', annotations: '[]' } },
            { id: 'i2', essay: 'E2', feedback: { feedback: 'GOOD_VARIANT_FEEDBACK', annotations: '[]' } },
          ],
        },
        {
          variantId: 'bad-variant',
          items: [
            { id: 'i3', essay: 'E3', feedback: { feedback: 'BAD_VARIANT_FEEDBACK', annotations: '[]' } },
            { id: 'i4', essay: 'E4', feedback: { feedback: 'BAD_VARIANT_FEEDBACK', annotations: '[]' } },
          ],
        },
      ],
    });

    expect(out).toHaveLength(2);
    expect(out[0].variantId).toBe('good-variant');
    expect(out[0].winRate).toBeGreaterThan(out[1].winRate);
    expect(out[1].variantId).toBe('bad-variant');
  });
});
