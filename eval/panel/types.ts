export type ReportKind = 'overall' | 'grammar' | 'transitions';

export interface DimScore { score: number; rationale: string }
export interface DimensionalJudgment { dimensions: Record<string, DimScore> }

export type PairwiseWinner = 'A' | 'B' | 'tie';
export interface PairwiseJudgment { winner: PairwiseWinner; rationale: string }

export interface Judge {
  id: string;
  lab: 'anthropic' | 'openai' | 'google';
  judgeDimensional(prompt: string): Promise<DimensionalJudgment>;
  judgePairwise(prompt: string): Promise<PairwiseJudgment>;
}

export function isDimScore(x: unknown): x is DimScore {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.score === 'number' && o.score >= 1 && o.score <= 5 && typeof o.rationale === 'string';
}
