import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { shouldRoute, appendGold, readGold } from './picker-store';

const verdict = (over: Partial<any> = {}) => ({ weightedMean: { A: 3, B: 3 }, majorityWinner: 'tie', positionBiasFlag: false, disagreement: false, perJudgePairwise: [], ...over });

describe('shouldRoute', () => {
  it('routes on disagreement regardless of sample', () => {
    expect(shouldRoute(verdict({ disagreement: true }), { sampleRate: 0, isNewVariant: false, rand: () => 1 })).toBe(true);
  });
  it('routes on the random sample', () => {
    expect(shouldRoute(verdict(), { sampleRate: 0.1, isNewVariant: false, rand: () => 0.05 })).toBe(true);
    expect(shouldRoute(verdict(), { sampleRate: 0.1, isNewVariant: false, rand: () => 0.5 })).toBe(false);
  });
});
describe('gold store', () => {
  it('round-trips labels', () => {
    const p = join(tmpdir(), `gold-${Math.floor(Math.random()*1e9)}.json`);
    appendGold(p, { itemId: 'i1', winner: 'A', ts: '2026-07-09' });
    expect(readGold(p)).toHaveLength(1);
    appendGold(p, { itemId: 'i2', winner: 'tie', ts: '2026-07-09' });
    expect(readGold(p).map(l => l.itemId)).toEqual(['i1', 'i2']);
  });
});
