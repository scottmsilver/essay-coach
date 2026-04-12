import { buildCriteriaPrompt, CRITERIA_SYSTEM_PROMPT, CRITERIA_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/criteria.js';
import { GoogleGenAI } from '@google/genai';

import type { ApiProvider, ProviderResponse, CallApiContextParams } from 'promptfoo';

class GeminiCriteriaGraderProvider implements ApiProvider {
  private model: string;

  constructor(options: { id?: string; config?: Record<string, unknown> } = {}) {
    this.model = (options.config?.model as string) || 'gemini-3.1-pro-preview';
  }

  id(): string {
    return `gemini-criteria-grader:${this.model}`;
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
    const teacherCriteria = vars.teacherCriteria as string || '';
    const assignmentPrompt = vars.assignmentPrompt as string || '';
    const writingType = vars.writingType as string || 'argumentative';
    const content = vars.content as string || prompt;

    if (!teacherCriteria) {
      return { error: 'No teacherCriteria provided in test vars' };
    }

    const criteriaPrompt = buildCriteriaPrompt({
      teacherCriteria,
      assignmentPrompt,
      writingType,
      content,
    });

    const startTime = Date.now();
    try {
      const ai = new GoogleGenAI({ apiKey });
      const response = await ai.models.generateContent({
        model: this.model,
        contents: criteriaPrompt,
        config: {
          systemInstruction: CRITERIA_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: CRITERIA_ANALYSIS_SCHEMA,
        },
      });

      const text = response.text;
      if (!text) {
        return { error: 'Gemini returned empty response' };
      }

      const latencyMs = Date.now() - startTime;
      return {
        output: text,
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

export default GeminiCriteriaGraderProvider;
