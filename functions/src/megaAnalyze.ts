/**
 * Mega-prompt analysis: one Gemini call that returns all 6 analyses.
 * Called from onDraftCreated when the mega feature flag is enabled.
 */
import { streamGeminiJson } from './streamGemini';
import { buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { MEGA_SYSTEM_PROMPT, MEGA_SCHEMA } from './megaPrompt';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';

interface MegaAnalyzeInput {
  apiKey: string;
  content: string;
  assignmentPrompt: string;
  writingType: string;
  draftNumber: number;
  previousEvaluation: Record<string, unknown> | null;
  model: string;
  draftRef: DocumentReference;
}

interface MegaResult {
  evaluation: Record<string, unknown>;
  grammarAnalysis: Record<string, unknown>;
  transitionAnalysis: Record<string, unknown>;
  promptAnalysis: Record<string, unknown>;
  duplicationAnalysis: Record<string, unknown>;
  coachSynthesis: Record<string, unknown>;
}

/**
 * Run all 6 analyses in a single Gemini call.
 * Returns the parsed mega response split into sections.
 */
export async function megaAnalyze(input: MegaAnalyzeInput): Promise<MegaResult> {
  // Build the user prompt (same logic as the separate evaluation path)
  let userPrompt: string;
  if (input.draftNumber > 1 && input.previousEvaluation) {
    userPrompt = buildResubmissionPrompt({
      assignmentPrompt: input.assignmentPrompt,
      writingType: input.writingType,
      content: input.content,
      previousEvaluation: JSON.stringify(input.previousEvaluation),
    });
  } else {
    userPrompt = buildEvaluationPrompt({
      assignmentPrompt: input.assignmentPrompt,
      writingType: input.writingType,
      content: input.content,
    });
  }

  // Append instruction to perform ALL analyses
  userPrompt += `\n\nPerform a complete analysis of this essay: score all 6+1 traits, analyze grammar, analyze transitions, check prompt adherence against the assignment prompt, identify duplicated ideas, and provide a coach synthesis. Return a single JSON object with all sections.`;

  // Add coach synthesis context
  userPrompt += `\n\nFor the coachSynthesis section: this is draft ${input.draftNumber}.${input.draftNumber === 1 ? ' Readiness must be "keep_going" and improvements must be null.' : ' Note improvements compared to the previous evaluation.'}`;

  logger.info('Starting mega analysis', { model: input.model, draftNumber: input.draftNumber });

  const outputText = await streamGeminiJson({
    apiKey: input.apiKey,
    contents: userPrompt,
    systemInstruction: MEGA_SYSTEM_PROMPT,
    responseSchema: MEGA_SCHEMA,
    progressRef: input.draftRef,
    statusField: 'evaluationStatus',
    generatingMessage: 'Analyzing essay...',
    model: input.model,
  });

  const result = JSON.parse(outputText) as MegaResult;

  // Basic validation: all 6 sections present
  const required = ['evaluation', 'grammarAnalysis', 'transitionAnalysis', 'promptAnalysis', 'duplicationAnalysis', 'coachSynthesis'] as const;
  for (const key of required) {
    if (!result[key] || typeof result[key] !== 'object') {
      throw new Error(`Mega response missing or invalid section: ${key}`);
    }
  }

  return result;
}
