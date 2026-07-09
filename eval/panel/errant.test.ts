import { describe, it, expect } from 'vitest';
import { fBeta, scoreEdits } from './errant';

describe('fBeta', () => {
  it('weights precision 2x recall at beta=0.5', () => {
    // high precision, low recall should beat low precision, high recall
    const a = fBeta(1.0, 0.5, 0.5);
    const b = fBeta(0.5, 1.0, 0.5);
    expect(a).toBeGreaterThan(b);
  });
});
describe('scoreEdits', () => {
  it('rewards exact matches, punishes false positives via precision', () => {
    const gold = [{ start: 0, end: 3, replacement: 'The' }];
    const sys = [{ start: 0, end: 3, replacement: 'The' }, { start: 5, end: 8, replacement: 'zzz' }];
    const r = scoreEdits(sys, gold);
    expect(r.recall).toBeCloseTo(1.0, 5);
    expect(r.precision).toBeCloseTo(0.5, 5); // one of two edits is a false positive
  });

  it('returns perfect scores when both system and gold are empty', () => {
    const r = scoreEdits([], []);
    expect(r.precision).toBe(1);
    expect(r.recall).toBe(1);
    expect(r.f05).toBe(1);
  });
});
