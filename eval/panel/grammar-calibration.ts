import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { fBeta, type Edit } from '../../shared/panel/errant';
import { buildPanel } from '../../shared/panel/judges';

/**
 * Score a model's extracted edits against gold edits, micro-averaged across
 * sentences: pool tp / |system| / |gold| counts across ALL sentences first,
 * then compute precision/recall once from the pooled counts, then
 * f05 = fBeta(p, r, 0.5). This is deliberately NOT an average of per-sentence
 * F scores — a handful of short sentences with few gold edits would otherwise
 * swamp the average the same as a long, edit-dense sentence.
 *
 * Iterates over gold's sentence ids. A sentence id missing from modelEdits
 * (whether absent entirely or present as an empty array) counts as zero
 * system edits for that sentence — its gold edits still count toward the
 * recall denominator, so unattempted sentences only hurt recall, not
 * precision.
 */
export function scoreModelAgainstGold(
  modelEdits: Record<string, Edit[]>,
  gold: Record<string, Edit[]>
): { precision: number; recall: number; f05: number } {
  let tp = 0;
  let systemCount = 0;
  let goldCount = 0;

  for (const sentenceId of Object.keys(gold)) {
    const goldEdits = gold[sentenceId];
    const systemEdits = modelEdits[sentenceId] ?? [];

    goldCount += goldEdits.length;
    systemCount += systemEdits.length;

    for (const sEdit of systemEdits) {
      for (const gEdit of goldEdits) {
        if (
          sEdit.start === gEdit.start &&
          sEdit.end === gEdit.end &&
          sEdit.replacement === gEdit.replacement
        ) {
          tp++;
          break; // don't double-count a system edit against multiple gold edits
        }
      }
    }
  }

  const precision = systemCount === 0 ? (goldCount === 0 ? 1 : 0) : tp / systemCount;
  const recall = goldCount === 0 ? 1 : tp / goldCount;
  const f05 = fBeta(precision, recall, 0.5);

  return { precision, recall, f05 };
}

// ---------------------------------------------------------------------------
// CLI: build a grammar-calibration leaderboard from a gold dataset.
// ---------------------------------------------------------------------------

export interface CalibrationSentence {
  id: string;
  text: string;
}

export interface CalibrationDataFile {
  sentences: CalibrationSentence[];
  gold: Record<string, Edit[]>;
}

export interface LeaderboardRow {
  modelId: string;
  precision: number;
  recall: number;
  f05: number;
}

/**
 * Extract edits for a set of sentences by calling out to a model.
 *
 * TODO: not implemented yet. v1 of the grammar-calibration track only scores
 * edits that were extracted offline and dropped into a pre-extracted edits
 * file (see the `argv[3]` handling in `main()` / eval/panel/data/README.md).
 * Wiring this up to call each panel model live (send sentence text, parse a
 * structured edit list back out) is a follow-up.
 */
export async function extractEditsWithModel(
  _modelId: string,
  _sentences: CalibrationSentence[]
): Promise<Record<string, Edit[]>> {
  throw new Error('not implemented — v1 runs from pre-extracted edit files');
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

async function main() {
  const dataPath = process.argv[2];
  if (!dataPath) {
    console.error('Usage: tsx grammar-calibration.ts <data.json> [pre-extracted-edits.json]');
    process.exit(1);
  }

  const data: CalibrationDataFile = JSON.parse(readFileSync(resolve(dataPath), 'utf-8'));
  const preExtractedPath = process.argv[3];

  let editsByModel: Record<string, Record<string, Edit[]>>;

  if (preExtractedPath) {
    editsByModel = JSON.parse(readFileSync(resolve(preExtractedPath), 'utf-8'));
  } else {
    // No pre-extracted edits given: fall through to live extraction against
    // the configured panel. v1 has no live extractor yet, so this surfaces
    // extractEditsWithModel's "not implemented" error rather than silently
    // producing an empty leaderboard.
    const judges = buildPanel(process.env, [], { allowPartial: true });
    editsByModel = {};
    for (const judge of judges) {
      editsByModel[judge.id] = await extractEditsWithModel(judge.id, data.sentences);
    }
  }

  const leaderboard: LeaderboardRow[] = Object.entries(editsByModel)
    .map(([modelId, edits]) => ({ modelId, ...scoreModelAgainstGold(edits, data.gold) }))
    .sort((a, b) => b.f05 - a.f05);

  console.log('Grammar calibration leaderboard (sorted by F0.5):');
  for (const row of leaderboard) {
    console.log(
      `  ${row.modelId.padEnd(30)} f0.5=${row.f05.toFixed(4)}  precision=${row.precision.toFixed(4)}  recall=${row.recall.toFixed(4)}`
    );
  }

  const outPath = resolve(__dirname, 'grammar-leaderboard.json');
  writeFileSync(outPath, JSON.stringify(leaderboard, null, 2));
  console.log(`Wrote ${outPath}`);
}

if (process.argv[1] === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
