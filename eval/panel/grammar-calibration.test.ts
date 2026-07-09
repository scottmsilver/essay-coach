import { describe, it, expect } from 'vitest';
import { scoreModelAgainstGold } from './grammar-calibration';

describe('scoreModelAgainstGold', () => {
  it('micro-averages precision/recall across sentences', () => {
    const gold = { s1: [{ start: 0, end: 3, replacement: 'The' }], s2: [{ start: 0, end: 1, replacement: 'A' }] };
    const model = { s1: [{ start: 0, end: 3, replacement: 'The' }], s2: [] };
    const r = scoreModelAgainstGold(model, gold);
    expect(r.recall).toBeCloseTo(0.5, 5); // 1 of 2 gold edits found
    expect(r.precision).toBeCloseTo(1.0, 5);
  });

  it('treats a sentence id missing from modelEdits entirely as zero system edits (recall drops, precision unaffected)', () => {
    const gold = { s1: [{ start: 0, end: 3, replacement: 'The' }], s2: [{ start: 0, end: 1, replacement: 'A' }] };
    // s2 has no key at all here, unlike the empty-array case above.
    const model = { s1: [{ start: 0, end: 3, replacement: 'The' }] };
    const r = scoreModelAgainstGold(model, gold);
    expect(r.recall).toBeCloseTo(0.5, 5);
    expect(r.precision).toBeCloseTo(1.0, 5);
  });
});
