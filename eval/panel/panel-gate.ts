import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { Judge, ReportKind } from '../../shared/panel/types';
import { runItem } from '../../shared/panel/run-panel';
import type { ItemVerdict } from '../../shared/panel/aggregate';
import { gateVerdict, DEFAULT_GATE, type GateThresholds } from '../../shared/panel/metrics';
import { shouldRoute } from './picker-store';
import { RUBRICS } from '../../shared/panel/rubrics';
import { buildPanel } from '../../shared/panel/judges';

export interface GateItem {
  id: string;
  essay: string;
  incumbent: { feedback: string; annotations: string };
  challenger: { feedback: string; annotations: string };
}

export interface RunGateInput {
  report: ReportKind;
  judges: Judge[];
  items: GateItem[];
  thresholds?: GateThresholds;
}

export interface RunGateOpts {
  rand?: () => number;
}

export interface RunGateOutput {
  verdict: { pass: boolean; reasons: string[] };
  perItem: ItemVerdict[];
  routed: string[];
}

const ROUTE_SAMPLE_RATE = 0.05;

export async function runGate(input: RunGateInput, opts: RunGateOpts = {}): Promise<RunGateOutput> {
  const { report, judges, items, thresholds } = input;
  const rand = opts.rand ?? Math.random;

  const perItem: ItemVerdict[] = await Promise.all(
    items.map((item) =>
      runItem({
        report,
        judges,
        essay: item.essay,
        feedbackA: item.incumbent.feedback,
        annotationsA: item.incumbent.annotations,
        feedbackB: item.challenger.feedback,
        annotationsB: item.challenger.annotations,
      })
    )
  );

  const routed: string[] = [];
  for (let i = 0; i < items.length; i++) {
    if (shouldRoute(perItem[i], { sampleRate: ROUTE_SAMPLE_RATE, isNewVariant: false, rand })) {
      routed.push(items[i].id);
    }
  }

  // challenger (side B) win rate: matches run-judge.ts's "wins + ties count
  // toward the challenger" convention, since a tie means the challenger held
  // its own against the incumbent rather than losing outright.
  const winOrTieCount = perItem.filter((v) => v.majorityWinner === 'B' || v.majorityWinner === 'tie').length;
  const challengerWinRate = items.length > 0 ? winOrTieCount / items.length : 0;

  const meanA = perItem.length > 0 ? perItem.reduce((sum, v) => sum + v.weightedMean.A, 0) / perItem.length : 0;
  const meanB = perItem.length > 0 ? perItem.reduce((sum, v) => sum + v.weightedMean.B, 0) / perItem.length : 0;
  const feedbackDelta = Math.abs(meanA - meanB);

  // Reliability v1 stand-in: fraction of items where the panel did NOT flag
  // internal disagreement, i.e. panel self-consistency on a single pass.
  // This is a placeholder for true reliability, which would rerun a sample
  // of items and measure agreement between runs (see RELIABILITY_SAMPLE_RATE
  // in run-judge.ts for the rerun-based approach used elsewhere).
  const reliability = perItem.length > 0 ? perItem.filter((v) => !v.disagreement).length / perItem.length : 1;

  const verdict = gateVerdict({ feedbackDelta, challengerWinRate, reliability }, thresholds ?? DEFAULT_GATE);

  return { verdict, perItem, routed };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface FixtureItem {
  id: string;
  essay: string;
  incumbent: { feedback: string; annotations: string };
  challenger: { feedback: string; annotations: string };
}

interface FixturesFile {
  report: ReportKind;
  items: FixtureItem[];
  thresholds?: GateThresholds;
}

async function main() {
  const fixturesPath = process.argv[2];
  if (!fixturesPath) {
    console.error('Usage: tsx panel-gate.ts <fixtures.json>');
    process.exit(1);
  }

  const fixtures: FixturesFile = JSON.parse(readFileSync(resolve(fixturesPath), 'utf-8'));
  const judges = buildPanel(process.env, RUBRICS[fixtures.report].dimensions);

  const result = await runGate({
    report: fixtures.report,
    judges,
    items: fixtures.items,
    thresholds: fixtures.thresholds,
  });

  console.log(`Gate verdict: ${result.verdict.pass ? 'PASS' : 'FAIL'}`);
  if (result.verdict.reasons.length > 0) {
    console.log('Reasons:');
    for (const reason of result.verdict.reasons) console.log(`  - ${reason}`);
  }
  console.log(`Items evaluated: ${result.perItem.length}`);
  console.log(`Routed to human review: ${result.routed.length > 0 ? result.routed.join(', ') : '(none)'}`);
}

if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
