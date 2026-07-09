import { describe, it, expect, vi } from 'vitest';
import { runGate } from './panel-gate';
import type { Judge } from './types';

const judge = (winner: 'A'|'B'): Judge => ({
  id: winner, lab: 'anthropic',
  judgeDimensional: vi.fn(async () => ({ dimensions: { correctness:{score:4,rationale:''}, coverage:{score:4,rationale:''}, falsePositiveRestraint:{score:4,rationale:''}, fixGuidance:{score:4,rationale:''} } })),
  judgePairwise: vi.fn(async () => ({ winner, rationale: '' })),
});

describe('runGate', () => {
  it('produces a pass/fail verdict and per-item results', async () => {
    const items = [{ id: 'i1', essay: 'E', incumbent: { feedback: 'inc', annotations: '[]' }, challenger: { feedback: 'chal', annotations: '[]' } }];
    const out = await runGate({ report: 'grammar', judges: [judge('A'), judge('A'), judge('B')], items });
    expect(out.verdict).toHaveProperty('pass');
    expect(out.perItem).toHaveLength(1);
  });
});
