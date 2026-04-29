import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { analyzeCoherenceWithGemini, type CoherenceAnalysis } from './coherence';

class AnalysisSkipped extends Error {
  constructor() { super('skipped'); }
}

function countParagraphs(content: string): number {
  return content.trim().split(/\n\s*\n+/).filter((p) => p.trim()).length;
}

async function analyzeCoherenceForDraft(ctx: AnalysisContext): Promise<CoherenceAnalysis> {
  if (countParagraphs(ctx.content) <= 1) {
    await ctx.draftRef.update({ coherenceStatus: null });
    throw new AnalysisSkipped();
  }

  const essayRef = ctx.draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const essayData = essaySnap.data();

  const input: Parameters<typeof analyzeCoherenceWithGemini>[1] = {
    assignmentPrompt: essayData?.assignmentPrompt || '',
    writingType: essayData?.writingType || 'argumentative',
    content: ctx.content,
  };

  return analyzeCoherenceWithGemini(ctx.apiKey, input, ctx.draftRef);
}

export const analyzeCoherence = createAnalysisHandler<CoherenceAnalysis>({
  name: 'coherence',
  dataField: 'coherenceAnalysis',
  statusField: 'coherenceStatus',
  analyze: analyzeCoherenceForDraft,
  logSummary: (result) => ({
    totalParagraphs: result.summary.totalParagraphs,
    supports: result.summary.supports,
    contrastsAcknowledged: result.summary.contrastsAcknowledged,
    contrastsUnacknowledged: result.summary.contrastsUnacknowledged,
    offTopic: result.summary.offTopic,
  }),
});
