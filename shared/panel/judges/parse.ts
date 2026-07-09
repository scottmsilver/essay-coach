import type { DimensionalJudgment, PairwiseJudgment, PairwiseWinner } from '../types';
import { isDimScore } from '../types';

/**
 * Extract the first JSON object embedded in a raw model response and validate
 * that every requested dimension is present and passes isDimScore. Throws
 * naming the missing/invalid dimension.
 */
export function parseDimensional(raw: string, dims: string[]): DimensionalJudgment {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in response: ${raw}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`Failed to parse JSON object from response: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Parsed response is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;

  const dimensions: Record<string, { score: number; rationale: string }> = {};
  for (const dim of dims) {
    const value = obj[dim];
    if (!isDimScore(value)) {
      throw new Error(`Missing or invalid dimension "${dim}" in judge response: ${raw}`);
    }
    dimensions[dim] = value;
  }
  return { dimensions };
}

const VALID_WINNERS: PairwiseWinner[] = ['A', 'B', 'tie'];

/**
 * Extract the first JSON object embedded in a raw model response and validate
 * it as a pairwise judgment ({ winner, rationale }).
 */
export function parsePairwise(raw: string): PairwiseJudgment {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) throw new Error(`No JSON object found in response: ${raw}`);

  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch (err) {
    throw new Error(`Failed to parse JSON object from response: ${(err as Error).message}`);
  }

  if (typeof parsed !== 'object' || parsed === null) {
    throw new Error('Parsed response is not a JSON object');
  }
  const obj = parsed as Record<string, unknown>;

  if (typeof obj.winner !== 'string' || !VALID_WINNERS.includes(obj.winner as PairwiseWinner)) {
    throw new Error(`Missing or invalid "winner" in pairwise response: ${raw}`);
  }
  if (typeof obj.rationale !== 'string') {
    throw new Error(`Missing or invalid "rationale" in pairwise response: ${raw}`);
  }

  return { winner: obj.winner as PairwiseWinner, rationale: obj.rationale };
}
