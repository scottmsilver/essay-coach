import { createAnalysisHandler } from './createAnalysisHandler';
import { analyzeGrammarWithGemini, type GrammarAnalysis } from './grammar';

export const analyzeGrammar = createAnalysisHandler<GrammarAnalysis>({
  name: 'grammar',
  dataField: 'grammarAnalysis',
  statusField: 'grammarStatus',
  analyze: (ctx) => analyzeGrammarWithGemini(ctx.apiKey, ctx.content, ctx.draftRef),
  logSummary: (result) => ({ totalErrors: result.summary.totalErrors }),
});
