import { createAnalysisHandler } from './createAnalysisHandler';
import { analyzeDuplicationWithGemini, type DuplicationAnalysis } from './duplication';

export const analyzeDuplication = createAnalysisHandler<DuplicationAnalysis>({
  name: 'duplication',
  dataField: 'duplicationAnalysis',
  statusField: 'duplicationStatus',
  analyze: (ctx) => analyzeDuplicationWithGemini(ctx.apiKey, ctx.content, ctx.draftRef),
  logSummary: (result) => ({ totalDuplications: result.summary.totalDuplications }),
});
