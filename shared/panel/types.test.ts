import { describe, it, expect } from 'vitest';
import { isDimScore } from './types';
describe('isDimScore', () => {
  it('accepts a valid dim score', () => {
    expect(isDimScore({ score: 4, rationale: 'x' })).toBe(true);
  });
  it('rejects out-of-range or malformed', () => {
    expect(isDimScore({ score: 9, rationale: 'x' })).toBe(false);
    expect(isDimScore({ score: 3 })).toBe(false);
    expect(isDimScore(null)).toBe(false);
  });
});
