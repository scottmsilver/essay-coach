import { SYSTEM_PROMPT } from './prompt';
import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';
import type { GenerateJsonFn } from './openRouterGenerate';

export const EVALUATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    traits: {
      type: 'object' as const,
      properties: Object.fromEntries(
        ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'].map(
          (trait) => [
            trait,
            {
              type: 'object' as const,
              properties: {
                score: { type: 'number' as const },
                feedback: { type: 'string' as const },
                revisionPriority: { type: 'number' as const, nullable: true },
                annotations: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      quotedText: { type: 'string' as const },
                      comment: { type: 'string' as const },
                      kind: { type: 'string' as const, enum: ['praise', 'suggestion'] },
                    },
                    required: ['quotedText', 'comment', 'kind'],
                  },
                },
              },
              required: ['score', 'feedback', 'revisionPriority', 'annotations'],
            },
          ]
        )
      ),
      required: ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'],
    },
    overallFeedback: { type: 'string' as const },
    revisionPlan: { type: 'array' as const, items: { type: 'string' as const } },
    comparisonToPrevious: {
      type: 'object' as const,
      nullable: true,
      properties: {
        scoreChanges: { type: 'object' as const },
        improvements: { type: 'array' as const, items: { type: 'string' as const } },
        remainingIssues: { type: 'array' as const, items: { type: 'string' as const } },
      },
    },
  },
  required: ['traits', 'overallFeedback', 'revisionPlan', 'comparisonToPrevious'],
};

export async function evaluateWithGemini(
  apiKey: string,
  userPrompt: string,
  progressRef?: DocumentReference,
  model?: string,
  opts?: { systemPromptOverride?: string; generateJson?: GenerateJsonFn },
): Promise<Record<string, unknown>> {
  const systemInstruction = opts?.systemPromptOverride || SYSTEM_PROMPT;

  // When an OpenRouter-backed generateJson is injected (eval cockpit
  // challenger running a non-Gemini model — see evalRun.ts's startEvalRun),
  // it takes over this main 'overall' generation call entirely instead of
  // streamGeminiJson, using the exact same system prompt / schema.
  const outputText = opts?.generateJson
    ? await opts.generateJson({
        contents: userPrompt,
        systemInstruction,
        responseSchema: EVALUATION_SCHEMA,
      })
    : await streamGeminiJson({
        apiKey,
        contents: userPrompt,
        systemInstruction,
        responseSchema: EVALUATION_SCHEMA,
        progressRef,
        statusField: 'evaluationStatus',
        generatingMessage: 'Writing feedback...',
        model,
      });

  return JSON.parse(outputText);
}
