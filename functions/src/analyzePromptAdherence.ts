import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { analyzePromptWithGemini, type PromptAnalysis } from './promptAdherence';

/** Sentinel error to tell the factory "nothing to do, don't write a result." */
class AnalysisSkipped extends Error {
  constructor() { super('skipped'); }
}

async function analyzePromptForDraft(ctx: AnalysisContext): Promise<PromptAnalysis> {
  const essayRef = ctx.draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const assignmentPrompt = essaySnap.data()?.assignmentPrompt;

  if (!assignmentPrompt?.trim()) {
    // No prompt to analyze. Clear any stale status and bail out.
    // Throwing AnalysisSkipped prevents the factory from writing a
    // fake result to promptAnalysis (which would crash the frontend).
    await ctx.draftRef.update({ promptStatus: null });
    throw new AnalysisSkipped();
  }

  return analyzePromptWithGemini(ctx.apiKey, assignmentPrompt, ctx.content, ctx.draftRef);
}

export const analyzePromptAdherence = createAnalysisHandler<PromptAnalysis>({
  name: 'prompt adherence',
  dataField: 'promptAnalysis',
  statusField: 'promptStatus',
  analyze: analyzePromptForDraft,
  logSummary: (result) => ({
    totalCells: result.summary?.totalCells,
    filledCells: result.summary?.filledCells,
  }),
});
