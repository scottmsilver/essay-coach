import { buildEvaluationPrompt, buildResubmissionPrompt } from '../../functions/lib/functions/src/prompt.js';
import { evaluateWithGemini } from '../../functions/lib/functions/src/gemini.js';

import type { ApiProvider, ProviderResponse, CallApiContextParams } from 'promptfoo';

class GeminiEssayGraderProvider implements ApiProvider {
  private model: string;

  constructor(options: { id?: string; config?: Record<string, unknown> } = {}) {
    this.model = (options.config?.model as string) || 'gemini-3.1-pro-preview';
  }

  id(): string {
    return `gemini-essay-grader:${this.model}`;
  }

  async callApi(
    prompt: string,
    context?: CallApiContextParams,
  ): Promise<ProviderResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { error: 'GEMINI_API_KEY env var is required' };
    }

    const vars = context?.vars || {};
    const assignmentPrompt = vars.assignmentPrompt as string || '';
    const writingType = vars.writingType as string || 'argumentative';
    const content = vars.content as string || prompt;
    const draftNumber = (vars.draftNumber as unknown as number) || 1;
    const previousEvaluation = vars.previousEvaluation as Record<string, unknown> | null || null;

    let evalPrompt: string;
    if (draftNumber > 1 && previousEvaluation) {
      evalPrompt = buildResubmissionPrompt({
        assignmentPrompt,
        writingType,
        content,
        previousEvaluation: JSON.stringify(previousEvaluation),
      });
    } else {
      evalPrompt = buildEvaluationPrompt({
        assignmentPrompt,
        writingType,
        content,
      });
    }

    const startTime = Date.now();
    try {
      const result = await evaluateWithGemini(apiKey, evalPrompt, undefined, this.model);
      const latencyMs = Date.now() - startTime;
      return {
        output: JSON.stringify(result),
        tokenUsage: {},
        cost: undefined,
        metadata: { latencyMs, model: this.model },
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        error: err instanceof Error ? err.message : String(err),
        metadata: { latencyMs, model: this.model },
      };
    }
  }
}

export default GeminiEssayGraderProvider;
