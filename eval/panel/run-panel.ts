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

export async function runItem(input: RunItemInput): Promise<ItemVerdict> {
  const { report, judges, essay, feedbackA, annotationsA, feedbackB, annotationsB } = input;

  const dimPromptA = buildDimensionalPrompt(report, essay, feedbackA, annotationsA);
  const dimPromptB = buildDimensionalPrompt(report, essay, feedbackB, annotationsB);
  const pairwisePromptAB = buildPairwisePrompt(report, essay, feedbackA, feedbackB);
  const pairwisePromptBA = buildPairwisePrompt(report, essay, feedbackB, feedbackA);

  const perJudgeResults = await Promise.all(
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

  const dimA = perJudgeResults.map((r) => r.dimA);
  const dimB = perJudgeResults.map((r) => r.dimB);
  const pairwiseAB = perJudgeResults.map((r) => r.pairwiseAB);
  const pairwiseBA = perJudgeResults.map((r) => r.pairwiseBA);

  return aggregateItem({
    weights: RUBRICS[report].weights,
    dimA,
    dimB,
    pairwiseAB,
    pairwiseBA,
  });
}
