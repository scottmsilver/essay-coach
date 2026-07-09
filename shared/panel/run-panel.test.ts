import { describe, it, expect, vi } from 'vitest';
import { runItem } from './run-panel';
import type { Judge } from './types';

function mockJudge(id: string): Judge {
  return {
    id, lab: 'anthropic',
    judgeDimensional: vi.fn(async () => ({ dimensions: { correctness: { score: 4, rationale: '' }, coverage: { score: 3, rationale: '' }, falsePositiveRestraint: { score: 4, rationale: '' }, fixGuidance: { score: 3, rationale: '' } } })),
    judgePairwise: vi.fn(async () => ({ winner: 'A' as const, rationale: '' })),
  };
}

describe('runItem', () => {
  it('calls each judge twice dimensionally and twice pairwise (AB+BA)', async () => {
    const j = mockJudge('m');
    await runItem({ report: 'grammar', judges: [j], essay: 'E', feedbackA: 'A', annotationsA: '[]', feedbackB: 'B', annotationsB: '[]' });
    expect(j.judgeDimensional).toHaveBeenCalledTimes(2);
    expect(j.judgePairwise).toHaveBeenCalledTimes(2);
  });
  it('returns an aggregated verdict', async () => {
    const v = await runItem({ report: 'grammar', judges: [mockJudge('a'), mockJudge('b'), mockJudge('c')], essay: 'E', feedbackA: 'A', annotationsA: '[]', feedbackB: 'B', annotationsB: '[]' });
    expect(v).toHaveProperty('majorityWinner');
    expect(v).toHaveProperty('positionBiasFlag');
  });
  it('sends the BA pairwise call with feedbackB appearing before feedbackA (order actually swapped)', async () => {
    const j = mockJudge('m');
    await runItem({ report: 'grammar', judges: [j], essay: 'E', feedbackA: 'FEEDBACK_A_TEXT', annotationsA: '[]', feedbackB: 'FEEDBACK_B_TEXT', annotationsB: '[]' });
    const pairwiseMock = j.judgePairwise as ReturnType<typeof vi.fn>;
    const prompts: string[] = pairwiseMock.mock.calls.map((call: unknown[]) => call[0] as string);
    expect(prompts).toHaveLength(2);

    // First call should be the AB order: A before B.
    const abPrompt = prompts[0];
    expect(abPrompt.indexOf('FEEDBACK_A_TEXT')).toBeGreaterThanOrEqual(0);
    expect(abPrompt.indexOf('FEEDBACK_B_TEXT')).toBeGreaterThanOrEqual(0);
    expect(abPrompt.indexOf('FEEDBACK_A_TEXT')).toBeLessThan(abPrompt.indexOf('FEEDBACK_B_TEXT'));

    // Second call should be the BA order: B before A (order actually swapped, not just called twice).
    const baPrompt = prompts[1];
    expect(baPrompt.indexOf('FEEDBACK_B_TEXT')).toBeGreaterThanOrEqual(0);
    expect(baPrompt.indexOf('FEEDBACK_A_TEXT')).toBeGreaterThanOrEqual(0);
    expect(baPrompt.indexOf('FEEDBACK_B_TEXT')).toBeLessThan(baPrompt.indexOf('FEEDBACK_A_TEXT'));
  });

  it('produces a verdict from survivors and lists the failed judge when one of three judges rejects', async () => {
    const good1 = mockJudge('good-1');
    const good2 = mockJudge('good-2');
    const bad = mockJudge('bad-judge');
    (bad.judgeDimensional as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('persistent failure'));

    const v = await runItem({
      report: 'grammar',
      judges: [good1, bad, good2],
      essay: 'E',
      feedbackA: 'A',
      annotationsA: '[]',
      feedbackB: 'B',
      annotationsB: '[]',
    });

    expect(v).toHaveProperty('majorityWinner');
    expect(v.failedJudges).toEqual(['bad-judge']);
  });

  it('rejects naming both failed judge ids when two of three judges reject', async () => {
    const good = mockJudge('good-1');
    const bad1 = mockJudge('bad-1');
    const bad2 = mockJudge('bad-2');
    (bad1.judgeDimensional as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('persistent failure'));
    (bad2.judgePairwise as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('persistent failure'));

    await expect(
      runItem({
        report: 'grammar',
        judges: [good, bad1, bad2],
        essay: 'E',
        feedbackA: 'A',
        annotationsA: '[]',
        feedbackB: 'B',
        annotationsB: '[]',
      })
    ).rejects.toThrow(/bad-1.*bad-2|bad-2.*bad-1/);
  });
});
