import { createAnalysisHandler } from './createAnalysisHandler';
import { analyzeTransitionsWithGemini } from './transitions';
import type { TransitionAnalysis } from '../../shared/transitionTypes';

export const analyzeTransitions = createAnalysisHandler<TransitionAnalysis>({
  name: 'transition',
  dataField: 'transitionAnalysis',
  statusField: 'transitionStatus',
  analyze: (ctx) => {
    // Pass previous analysis for stabilization (prevents flipping on unchanged text)
    const previous = ctx.draftData.transitionAnalysis as TransitionAnalysis | null ?? null;
    return analyzeTransitionsWithGemini(ctx.apiKey, ctx.content, ctx.draftRef, previous);
  },
  logSummary: (result) => ({
    sentenceCount: result.sentenceTransitions.length,
    paragraphCount: result.paragraphTransitions.length,
  }),
});
