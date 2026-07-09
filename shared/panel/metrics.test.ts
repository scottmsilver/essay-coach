import { describe, it, expect } from 'vitest';
import { cohensKappa, gateVerdict, DEFAULT_GATE } from './metrics';

describe('cohensKappa', () => {
  it('is 1.0 for perfect agreement', () => {
    expect(cohensKappa(['A','B','A','tie'], ['A','B','A','tie'])).toBeCloseTo(1.0, 5);
  });
  it('is ~0 for chance agreement', () => {
    const k = cohensKappa(['A','A','B','B'], ['A','B','A','B']);
    expect(k).toBeLessThan(0.1);
  });
  it('throws on mismatched-length input', () => {
    expect(() => cohensKappa(['A', 'B'], ['A'])).toThrow();
  });
});
describe('gateVerdict', () => {
  it('passes when all thresholds met', () => {
    const v = gateVerdict({ feedbackDelta: 0.3, challengerWinRate: 0.5, reliability: 0.9 }, DEFAULT_GATE);
    expect(v.pass).toBe(true);
  });
  it('fails and names the failing metric', () => {
    const v = gateVerdict({ feedbackDelta: 0.7, challengerWinRate: 0.5, reliability: 0.9 });
    expect(v.pass).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/delta/i);
  });
});
