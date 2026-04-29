import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { analyzeReasoningWithGemini, type ReasoningAnalysis } from './reasoning';

class AnalysisSkipped extends Error {
  constructor() { super('skipped'); }
}

function countParagraphs(content: string): number {
  return content.trim().split(/\n\s*\n+/).filter((p) => p.trim()).length;
}

async function analyzeReasoningForDraft(ctx: AnalysisContext): Promise<ReasoningAnalysis> {
  if (countParagraphs(ctx.content) <= 1) {
    await ctx.draftRef.update({ reasoningStatus: null });
    throw new AnalysisSkipped();
  }

  const essayRef = ctx.draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const essayData = essaySnap.data();

  const input: Parameters<typeof analyzeReasoningWithGemini>[1] = {
    assignmentPrompt: essayData?.assignmentPrompt || '',
    writingType: essayData?.writingType || 'argumentative',
    content: ctx.content,
  };

  return analyzeReasoningWithGemini(ctx.apiKey, input, ctx.draftRef);
}

export const analyzeReasoning = createAnalysisHandler<ReasoningAnalysis>({
  name: 'reasoning',
  dataField: 'reasoningAnalysis',
  statusField: 'reasoningStatus',
  analyze: analyzeReasoningForDraft,
  logSummary: (result) => ({
    totalParagraphs: result.summary.totalParagraphs,
    sound: result.summary.sound,
    circular: result.summary.circular,
    notApplicable: result.summary.notApplicable,
  }),
});
