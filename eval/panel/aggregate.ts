import type { DimensionalJudgment, PairwiseJudgment, PairwiseWinner } from './types';

export interface ItemVerdict {
  weightedMean: Record<'A' | 'B', number>;
  majorityWinner: 'A' | 'B' | 'tie';
  positionBiasFlag: boolean;
  disagreement: boolean;
  perJudgePairwise: PairwiseWinner[];
}

function weightedMeanForSide(judgments: DimensionalJudgment[], weights: Record<string, number>): number {
  const ratios: number[] = [];
  for (const judgment of judgments) {
    let numerator = 0;
    let denominator = 0;
    for (const [dim, weight] of Object.entries(weights)) {
      const dimScore = judgment.dimensions[dim];
      if (dimScore === undefined) continue; // dimension missing from this judgment: skip from both num and denom
      numerator += dimScore.score * weight;
      denominator += weight;
    }
    if (denominator > 0) ratios.push(numerator / denominator);
  }
  if (ratios.length === 0) return 0;
  return ratios.reduce((sum, r) => sum + r, 0) / ratios.length;
}

// PairwiseWinner labels are positional, not tied to original content identity:
// 'A' always means "the first-listed item won" and 'B' means "the second-listed
// item won," regardless of which content (A or B) occupied that slot for a
// given call. In AB order, slot 1 = content A, so the raw verdict already
// matches the A-first content frame. In BA order, slot 1 = content B, so a
// raw verdict must be flipped to translate it back into the A-first frame.
function mapBAToAFrame(winner: PairwiseWinner): PairwiseWinner {
  if (winner === 'A') return 'B';
  if (winner === 'B') return 'A';
  return 'tie';
}

function mode(votes: PairwiseWinner[]): { winner: 'A' | 'B' | 'tie'; disagreement: boolean } {
  const counts: Record<PairwiseWinner, number> = { A: 0, B: 0, tie: 0 };
  for (const v of votes) counts[v]++;
  const total = votes.length;
  if (total === 0) return { winner: 'tie', disagreement: true };

  const candidates: Array<'A' | 'B' | 'tie'> = ['A', 'B', 'tie'];
  for (const label of candidates) {
    if (counts[label] * 2 > total) {
      return { winner: label, disagreement: false };
    }
  }
  return { winner: 'tie', disagreement: true };
}

export function aggregateItem(input: {
  weights: Record<string, number>;
  dimA: DimensionalJudgment[];
  dimB: DimensionalJudgment[];
  pairwiseAB: PairwiseJudgment[];
  pairwiseBA: PairwiseJudgment[];
}): ItemVerdict {
  const { weights, dimA, dimB, pairwiseAB, pairwiseBA } = input;

  const weightedMean: Record<'A' | 'B', number> = {
    A: weightedMeanForSide(dimA, weights),
    B: weightedMeanForSide(dimB, weights),
  };

  // Order-corrected verdicts, all expressed in the A-first content frame.
  const correctedAB: PairwiseWinner[] = pairwiseAB.map((j) => j.winner);
  const mappedBA: PairwiseWinner[] = pairwiseBA.map((j) => mapBAToAFrame(j.winner));

  const { winner: majorityWinner, disagreement } = mode([...correctedAB, ...mappedBA]);

  // Per-judge position sensitivity: does judge i's AB verdict (order-corrected,
  // i.e. as-is) disagree with its mapped BA verdict?
  const judgeCount = Math.min(pairwiseAB.length, pairwiseBA.length);
  let positionSensitiveCount = 0;
  const perJudgePairwise: PairwiseWinner[] = [];
  for (let i = 0; i < judgeCount; i++) {
    const ab = correctedAB[i];
    const ba = mappedBA[i];
    if (ab !== ba) {
      positionSensitiveCount++;
      perJudgePairwise.push('tie');
    } else {
      perJudgePairwise.push(ab);
    }
  }
  const judgeMajorityFlag = judgeCount > 0 && positionSensitiveCount >= judgeCount / 2;

  // Raw first-slot pick rate: across ALL raw verdicts (both orders, unmapped),
  // 'A' always denotes "the first-listed item was picked." Ties excluded.
  const rawVerdicts: PairwiseWinner[] = [
    ...pairwiseAB.map((j) => j.winner),
    ...pairwiseBA.map((j) => j.winner),
  ];
  const nonTie = rawVerdicts.filter((w) => w !== 'tie');
  let rateFlag = false;
  if (nonTie.length > 0) {
    const firstPicks = nonTie.filter((w) => w === 'A').length;
    const pFirst = firstPicks / nonTie.length;
    rateFlag = Math.abs(pFirst - 0.5) > 0.10;
  }

  const positionBiasFlag = judgeMajorityFlag || rateFlag;

  return {
    weightedMean,
    majorityWinner,
    positionBiasFlag,
    disagreement,
    perJudgePairwise,
  };
}
