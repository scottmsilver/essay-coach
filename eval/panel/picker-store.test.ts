import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { writeFileSync, readFileSync } from 'fs';
import { shouldRoute, appendGold, readGold } from './picker-store';
import type { ItemVerdict } from './aggregate';

const verdict = (over: Partial<ItemVerdict> = {}): ItemVerdict => ({ weightedMean: { A: 3, B: 3 }, majorityWinner: 'tie', positionBiasFlag: false, disagreement: false, perJudgePairwise: [], ...over });

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

  it('throws instead of silently discarding a corrupt gold file', () => {
    const p = join(tmpdir(), `gold-corrupt-${Math.floor(Math.random()*1e9)}.json`);
    const garbage = '{ not valid json !!!';
    writeFileSync(p, garbage);

    expect(() => readGold(p)).toThrow(p);
    expect(() => appendGold(p, { itemId: 'i3', winner: 'A', ts: '2026-07-09' })).toThrow(p);

    // The corrupt file must be preserved, not overwritten by the failed append.
    expect(readFileSync(p, 'utf-8')).toBe(garbage);
  });
});
