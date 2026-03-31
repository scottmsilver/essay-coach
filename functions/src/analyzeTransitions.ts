import { createAnalysisHandler } from './createAnalysisHandler';
import { analyzeTransitionsWithGemini } from './transitions';
import type { TransitionAnalysis } from '../../shared/transitionTypes';

export const analyzeTransitions = createAnalysisHandler<TransitionAnalysis>({
  name: 'transition',
  dataField: 'transitionAnalysis',
  statusField: 'transitionStatus',
  analyze: (ctx) => analyzeTransitionsWithGemini(ctx.apiKey, ctx.content, ctx.draftRef),
  logSummary: (result) => ({
    sentenceCount: result.sentenceTransitions.length,
    paragraphCount: result.paragraphTransitions.length,
  }),
});
