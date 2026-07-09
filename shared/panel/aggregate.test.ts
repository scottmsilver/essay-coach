import { describe, it, expect } from 'vitest';
import { aggregateItem } from './aggregate';

const dj = (scores: Record<string, number>) => ({
  dimensions: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v, rationale: '' }])),
});
const W = { correctness: 2, coverage: 1 };

describe('aggregateItem', () => {
  it('weights dimensions and picks the higher-scoring side', () => {
    const dimA = [dj({ correctness: 5, coverage: 1 })]; // (5*2+1)/3 = 3.67
    const dimB = [dj({ correctness: 2, coverage: 2 })]; // (2*2+2)/3 = 2.00
    const v = aggregateItem({ weights: W, dimA, dimB, pairwiseAB: [{ winner: 'A', rationale: '' }], pairwiseBA: [{ winner: 'B', rationale: '' }] });
    expect(v.weightedMean.A).toBeCloseTo(3.67, 1);
    expect(v.weightedMean.B).toBeCloseTo(2.0, 1);
  });
  it('majority winner is order-corrected: AB=A and BA=B both mean "A"', () => {
    const three = (w: 'A'|'B') => [{ winner: w, rationale: '' }];
    // AB says A, BA says B -> both point at the A-first content -> winner A
    const v = aggregateItem({ weights: W, dimA: [dj({correctness:3,coverage:3})], dimB: [dj({correctness:3,coverage:3})],
      pairwiseAB: three('A'), pairwiseBA: three('B') });
    expect(v.majorityWinner).toBe('A');
    expect(v.positionBiasFlag).toBe(false);
  });
  it('flags position bias when AB and BA both favor the first-listed slot', () => {
    // AB says A (first slot), BA says A (first slot = the B content) -> contradictory -> position bias
    const v = aggregateItem({ weights: W, dimA: [dj({correctness:3,coverage:3})], dimB: [dj({correctness:3,coverage:3})],
      pairwiseAB: [{winner:'A',rationale:''}], pairwiseBA: [{winner:'A',rationale:''}] });
    expect(v.positionBiasFlag).toBe(true);
  });

  it('with 3 judges, an even order-corrected split yields tie + disagreement, and total position reversal flags bias', () => {
    const dimA = [dj({correctness:3,coverage:3}), dj({correctness:3,coverage:3}), dj({correctness:3,coverage:3})];
    const dimB = dimA;
    // AB (content-frame direct): A, A, B
    const pairwiseAB = [{winner:'A',rationale:''}, {winner:'A',rationale:''}, {winner:'B',rationale:''}] as const;
    // Raw BA (positional labels): A, A, B -> mapped to content frame (A->B, B->A): B, B, A
    const pairwiseBA = [{winner:'A',rationale:''}, {winner:'A',rationale:''}, {winner:'B',rationale:''}] as const;
    const v = aggregateItem({ weights: W, dimA, dimB, pairwiseAB: [...pairwiseAB], pairwiseBA: [...pairwiseBA] });
    // combined corrected votes: A,A,B (AB) + B,B,A (mapped BA) = 3 A's, 3 B's -> no strict majority
    expect(v.majorityWinner).toBe('tie');
    expect(v.disagreement).toBe(true);
    // every judge's AB verdict disagrees with its mapped BA verdict -> full position reversal
    expect(v.positionBiasFlag).toBe(true);
    expect(v.perJudgePairwise).toEqual(['tie', 'tie', 'tie']);
  });

  it('with 3 judges, a clean strict majority with no position sensitivity does not flag bias', () => {
    const dimA = [dj({correctness:3,coverage:3}), dj({correctness:3,coverage:3}), dj({correctness:3,coverage:3})];
    const dimB = dimA;
    const pairwiseAB = [{winner:'A',rationale:''}, {winner:'A',rationale:''}, {winner:'A',rationale:''}] as const;
    // Raw BA all 'B' (positional second slot) -> mapped to content frame (B->A): A, A, A
    const pairwiseBA = [{winner:'B',rationale:''}, {winner:'B',rationale:''}, {winner:'B',rationale:''}] as const;
    const v = aggregateItem({ weights: W, dimA, dimB, pairwiseAB: [...pairwiseAB], pairwiseBA: [...pairwiseBA] });
    expect(v.majorityWinner).toBe('A');
    expect(v.disagreement).toBe(false);
    expect(v.positionBiasFlag).toBe(false);
    expect(v.perJudgePairwise).toEqual(['A', 'A', 'A']);
  });
});
