import type { Judge, ReportKind } from './types';
import { RUBRICS, buildDimensionalPrompt, buildPairwisePrompt } from './rubrics';
import { aggregateItem, type ItemVerdict } from './aggregate';

export interface RunItemInput {
  report: ReportKind;
  judges: Judge[];
  essay: string;
  feedbackA: string;
  annotationsA: string;
  feedbackB: string;
  annotationsB: string;
}

export type RunItemResult = ItemVerdict & { failedJudges?: string[] };

export async function runItem(input: RunItemInput): Promise<RunItemResult> {
  const { report, judges, essay, feedbackA, annotationsA, feedbackB, annotationsB } = input;

  const dimPromptA = buildDimensionalPrompt(report, essay, feedbackA, annotationsA);
  const dimPromptB = buildDimensionalPrompt(report, essay, feedbackB, annotationsB);
  const pairwisePromptAB = buildPairwisePrompt(report, essay, feedbackA, feedbackB);
  const pairwisePromptBA = buildPairwisePrompt(report, essay, feedbackB, feedbackA);

  // Run each judge's 4 calls independently and isolate failures per-judge: a
  // single judge that exhausts its retries (retry logic lives inside the
  // Judge implementation) must not discard every other judge's successful
  // results. Promise.allSettled lets survivors carry the item.
  const settled = await Promise.allSettled(
    judges.map(async (judge) => {
      const [dimA, dimB, pairwiseAB, pairwiseBA] = await Promise.all([
        judge.judgeDimensional(dimPromptA),
        judge.judgeDimensional(dimPromptB),
        judge.judgePairwise(pairwisePromptAB),
        judge.judgePairwise(pairwisePromptBA),
      ]);
      return { dimA, dimB, pairwiseAB, pairwiseBA };
    })
  );

  type PerJudgeResult = {
    dimA: Awaited<ReturnType<Judge['judgeDimensional']>>;
    dimB: Awaited<ReturnType<Judge['judgeDimensional']>>;
    pairwiseAB: Awaited<ReturnType<Judge['judgePairwise']>>;
    pairwiseBA: Awaited<ReturnType<Judge['judgePairwise']>>;
  };
  const survivorResults: PerJudgeResult[] = [];
  const failedJudges: string[] = [];

  settled.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      survivorResults.push(result.value);
    } else {
      failedJudges.push(judges[i].id);
    }
  });

  // Only treat this as fatal when there were actual failures reducing the
  // panel below a meaningful majority (>=2 survivors). A panel run with a
  // single judge and zero failures is unaffected (e.g. tests/dev usage).
  if (failedJudges.length > 0 && survivorResults.length < 2) {
    throw new Error(
      `runItem: too few judges survived to form a majority (failed: ${failedJudges.join(', ')}; ` +
        `${survivorResults.length} of ${judges.length} succeeded)`
    );
  }

  const dimA = survivorResults.map((r) => r.dimA);
  const dimB = survivorResults.map((r) => r.dimB);
  const pairwiseAB = survivorResults.map((r) => r.pairwiseAB);
  const pairwiseBA = survivorResults.map((r) => r.pairwiseBA);

  const verdict = aggregateItem({
    weights: RUBRICS[report].weights,
    dimA,
    dimB,
    pairwiseAB,
    pairwiseBA,
  });

  return failedJudges.length > 0 ? { ...verdict, failedJudges } : { ...verdict };
}
