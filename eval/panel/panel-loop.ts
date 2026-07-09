import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Judge, ReportKind } from './types';
import { runItem } from './run-panel';
import { RUBRICS } from './rubrics';
import { buildPanel } from './judges';

export interface LoopItem {
  id: string;
  essay: string;
  feedback: { feedback: string; annotations: string };
}

export interface LoopVariant {
  variantId: string;
  items: LoopItem[];
}

export interface RunLoopInput {
  report: ReportKind;
  judges: Judge[];
  baseline: { feedback: string; annotations: string };
  variants: LoopVariant[];
}

export interface VariantRanking {
  variantId: string;
  winRate: number;
  meanScore: number;
}

/**
 * Ranks candidate prompts/models by scoring each variant's items against the
 * SAME baseline (side A = incumbent/baseline, side B = challenger/variant),
 * via runItem, and ranking by (win-or-tie rate, then mean weightedMean.B)
 * descending. Pure orchestration — no aggregation logic lives here beyond
 * summarizing runItem's per-item verdicts.
 */
export async function runLoop(input: RunLoopInput): Promise<VariantRanking[]> {
  const { report, judges, baseline, variants } = input;

  const rankings: VariantRanking[] = await Promise.all(
    variants.map(async (variant) => {
      const verdicts = await Promise.all(
        variant.items.map((item) =>
          runItem({
            report,
            judges,
            essay: item.essay,
            feedbackA: baseline.feedback,
            annotationsA: baseline.annotations,
            feedbackB: item.feedback.feedback,
            annotationsB: item.feedback.annotations,
          })
        )
      );

      const n = verdicts.length;
      const winOrTieCount = verdicts.filter((v) => v.majorityWinner === 'B' || v.majorityWinner === 'tie').length;
      const winRate = n > 0 ? winOrTieCount / n : 0;
      const meanScore = n > 0 ? verdicts.reduce((sum, v) => sum + v.weightedMean.B, 0) / n : 0;

      return { variantId: variant.variantId, winRate, meanScore };
    })
  );

  return rankings.sort((a, b) => b.winRate - a.winRate || b.meanScore - a.meanScore);
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FixturesFile {
  report: ReportKind;
  baseline: { feedback: string; annotations: string };
  variants: LoopVariant[];
}

async function main() {
  const fixturesPath = process.argv[2];
  if (!fixturesPath) {
    console.error('Usage: tsx panel-loop.ts <fixtures.json>');
    process.exit(1);
  }

  const fixtures: FixturesFile = JSON.parse(readFileSync(resolve(fixturesPath), 'utf-8'));
  const judges = buildPanel(process.env, RUBRICS[fixtures.report].dimensions);

  const ranking = await runLoop({
    report: fixtures.report,
    judges,
    baseline: fixtures.baseline,
    variants: fixtures.variants,
  });

  console.log('Variant ranking (best first):');
  ranking.forEach((r, i) => {
    console.log(`  ${i + 1}. ${r.variantId} — winRate=${r.winRate.toFixed(2)} meanScore=${r.meanScore.toFixed(2)}`);
  });
}

if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
