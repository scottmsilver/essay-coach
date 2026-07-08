import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { analyzeStructureWithGemini, type StructureAnalysis } from './structure';

class AnalysisSkipped extends Error {
  constructor() { super('skipped'); }
}

function countParagraphs(content: string): number {
  return content.trim().split(/\n\s*\n+/).filter((p) => p.trim()).length;
}

async function analyzeStructureForDraft(ctx: AnalysisContext): Promise<StructureAnalysis> {
  if (countParagraphs(ctx.content) <= 1) {
    await ctx.draftRef.update({ structureStatus: null });
    throw new AnalysisSkipped();
  }

  const essayRef = ctx.draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const essayData = essaySnap.data();

  const input: Parameters<typeof analyzeStructureWithGemini>[1] = {
    assignmentPrompt: essayData?.assignmentPrompt || '',
    writingType: essayData?.writingType || 'argumentative',
    content: ctx.content,
  };

  return analyzeStructureWithGemini(ctx.apiKey, input, ctx.draftRef);
}

export const analyzeStructure = createAnalysisHandler<StructureAnalysis>({
  name: 'structure',
  dataField: 'structureAnalysis',
  statusField: 'structureStatus',
  analyze: analyzeStructureForDraft,
  logSummary: (result) => ({
    totalParagraphs: result.summary.totalParagraphs,
    complete: result.summary.complete,
    missingAnalysis: result.summary.missingAnalysis,
    missingEvidence: result.summary.missingEvidence,
    missingClaim: result.summary.missingClaim,
    offPattern: result.summary.offPattern,
  }),
});
