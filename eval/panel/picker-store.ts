import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { PairwiseWinner } from '../../shared/panel/types';
import type { ItemVerdict } from '../../shared/panel/aggregate';

export interface GoldLabel {
  itemId: string;
  winner: PairwiseWinner;
  note?: string;
  ts: string;
}

export function shouldRoute(
  v: ItemVerdict,
  opts: { sampleRate: number; isNewVariant: boolean; rand: () => number }
): boolean {
  return v.disagreement || v.positionBiasFlag || opts.isNewVariant || opts.rand() < opts.sampleRate;
}

// Reads and parses an existing gold file. Missing file returns []. A file
// that exists but cannot be parsed as a JSON array is a corruption signal —
// silently treating it as empty would cause appendGold to overwrite (and
// thereby destroy) previously recorded human labels, so we throw instead.
function readGoldFileOrThrow(path: string): GoldLabel[] {
  if (!existsSync(path)) {
    return [];
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf-8'));
  } catch (err) {
    throw new Error(`Gold file at ${path} exists but is not valid JSON: ${(err as Error).message}`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`Gold file at ${path} exists but does not contain a JSON array`);
  }

  return parsed as GoldLabel[];
}

export function appendGold(path: string, label: GoldLabel): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const existing = readGoldFileOrThrow(path);

  existing.push(label);
  writeFileSync(path, JSON.stringify(existing, null, 2));
}

export function readGold(path: string): GoldLabel[] {
  return readGoldFileOrThrow(path);
}
