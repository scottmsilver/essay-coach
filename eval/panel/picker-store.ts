import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname } from 'path';
import type { ItemVerdict, PairwiseWinner } from './types';

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

export function appendGold(path: string, label: GoldLabel): void {
  const dir = dirname(path);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  let existing: GoldLabel[] = [];
  if (existsSync(path)) {
    try {
      existing = JSON.parse(readFileSync(path, 'utf-8'));
    } catch {
      existing = [];
    }
  }

  existing.push(label);
  writeFileSync(path, JSON.stringify(existing, null, 2));
}

export function readGold(path: string): GoldLabel[] {
  if (!existsSync(path)) {
    return [];
  }

  try {
    return JSON.parse(readFileSync(path, 'utf-8'));
  } catch {
    return [];
  }
}
