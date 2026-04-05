/**
 * Autotune analysis mode: 3 Flash Lite calls.
 *
 * Call 1: eval + duplication + grammar + promptAdherence (mega, v3 boost on eval)
 * Call 2: transitions (separate, with transBoost + production sentence formatting)
 * Call 3: coachSynthesis (separate, needs other results as input)
 *
 * 73/73 validated on production essays. ~97-99% cost reduction vs 6x Pro.
 */
import { streamGeminiJson } from './streamGemini';
import { SYSTEM_PROMPT, buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { EVALUATION_SCHEMA } from './gemini';
import { GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA } from './grammar';
import { TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA, TRANS_COVERAGE_BOOST,
         splitEssayIntoSentences, formatSentencesForPrompt, buildTransitionPrompt } from './transitions';
import { PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA } from './promptAdherence';
import { DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA } from './duplication';
import { COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA } from './synthesizeCoach';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';

const MODEL = 'gemini-3.1-flash-lite-preview';

const V3_BOOST = `

## CRITICAL: FEEDBACK QUALITY STANDARDS
Every feedback statement must reference EXACT text from the essay. No generic praise or criticism.
Name the specific craft move or error type. Check for factual errors and anachronisms.
Each annotation must end with a Socratic question referencing the student's actual words.
Before finalizing: verify every feedback cites specific text and every annotation has a Socratic question.`;

interface AutotuneInput {
  apiKey: string;
  content: string;
  assignmentPrompt: string;
  writingType: string;
  draftNumber: number;
  previousEvaluation: Record<string, unknown> | null;
  draftRef: DocumentReference;
}

interface AutotuneResult {
  evaluation: Record<string, unknown>;
  grammarAnalysis: Record<string, unknown>;
  transitionAnalysis: Record<string, unknown>;
  promptAnalysis: Record<string, unknown>;
  duplicationAnalysis: Record<string, unknown>;
  coachSynthesis: Record<string, unknown>;
}

// ── Call 1: Mega (eval + dup + grammar + prompt) ────────────────────────

const MEGA_SYSTEM = `${SYSTEM_PROMPT}${V3_BOOST}

## GRAMMAR ANALYSIS
${GRAMMAR_SYSTEM_PROMPT}

## PROMPT ADHERENCE ANALYSIS
${PROMPT_ADHERENCE_SYSTEM_PROMPT}

## DUPLICATION ANALYSIS
${DUPLICATION_SYSTEM_PROMPT}`;

const MEGA_SCHEMA = {
  type: 'object' as const,
  properties: {
    evaluation: EVALUATION_SCHEMA,
    grammarAnalysis: GRAMMAR_ANALYSIS_SCHEMA,
    promptAnalysis: PROMPT_ANALYSIS_SCHEMA,
    duplicationAnalysis: DUPLICATION_ANALYSIS_SCHEMA,
  },
  required: ['evaluation', 'grammarAnalysis', 'promptAnalysis', 'duplicationAnalysis'] as const,
};

// ── Main ────────────────────────────────────────────────────────────────

export async function autotuneAnalyze(input: AutotuneInput): Promise<AutotuneResult> {
  const { apiKey, content, assignmentPrompt, writingType, draftNumber, previousEvaluation, draftRef } = input;

  logger.info('Starting autotune analysis (3-call Flash Lite)', { draftNumber });

  // Build evaluation user prompt
  let evalPrompt: string;
  if (draftNumber > 1 && previousEvaluation) {
    evalPrompt = buildResubmissionPrompt({
      assignmentPrompt, writingType, content,
      previousEvaluation: JSON.stringify(previousEvaluation),
    });
  } else {
    evalPrompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
  }

  // Append mega instructions
  evalPrompt += `\n\nAlso analyze grammar, check prompt adherence against the assignment prompt, and identify duplicated ideas. Return a single JSON with evaluation, grammarAnalysis, promptAnalysis, and duplicationAnalysis sections.`;

  // ── Call 1 + Call 2 in parallel ───────────────────────────────────────

  // Call 2 prep: transitions with production sentence formatting + transBoost
  const sentences = await splitEssayIntoSentences(content);
  const formatted = formatSentencesForPrompt(sentences);
  const transPrompt = buildTransitionPrompt(formatted);
  const transSystem = TRANSITION_SYSTEM_PROMPT + TRANS_COVERAGE_BOOST;

  const [megaOutput, transOutput] = await Promise.all([
    // Call 1: mega (eval + dup + grammar + prompt)
    streamGeminiJson({
      apiKey,
      contents: evalPrompt,
      systemInstruction: MEGA_SYSTEM,
      responseSchema: MEGA_SCHEMA,
      progressRef: draftRef,
      statusField: 'evaluationStatus',
      generatingMessage: 'Analyzing essay...',
      model: MODEL,
    }).then(text => JSON.parse(text)),

    // Call 2: transitions (separate, with transBoost)
    streamGeminiJson({
      apiKey,
      contents: transPrompt,
      systemInstruction: transSystem,
      responseSchema: TRANSITION_SCHEMA,
      progressRef: draftRef,
      statusField: 'transitionStatus',
      generatingMessage: 'Analyzing transitions...',
      model: MODEL,
    }).then(text => JSON.parse(text)),
  ]);

  // ── Call 3: coach synthesis (needs other results) ─────────────────────

  const coachPrompt = `Draft number: ${draftNumber}
Has assignment prompt: ${!!assignmentPrompt}

## Trait Evaluation
${JSON.stringify(megaOutput.evaluation)}

## Grammar Analysis
${JSON.stringify(megaOutput.grammarAnalysis)}

## Transition Analysis
${JSON.stringify(transOutput)}

## Prompt Adherence Analysis
${assignmentPrompt ? JSON.stringify(megaOutput.promptAnalysis) : 'No assignment prompt provided — omit "prompt" from reportSummaries.'}

## Duplication Analysis
${JSON.stringify(megaOutput.duplicationAnalysis)}

Produce a coaching synthesis JSON.${draftNumber === 1 ? ' This is draft 1 — readiness must be "keep_going". improvements must be null.' : ' Compare to previous data and note improvements.'}`;

  const coachText = await streamGeminiJson({
    apiKey,
    contents: coachPrompt,
    systemInstruction: COACH_SYNTHESIS_SYSTEM,
    responseSchema: COACH_SYNTHESIS_SCHEMA,
    progressRef: draftRef,
    statusField: 'coachSynthesisStatus',
    generatingMessage: 'Preparing coaching summary...',
    model: MODEL,
  });
  const coachOutput = JSON.parse(coachText);

  return {
    evaluation: megaOutput.evaluation,
    grammarAnalysis: megaOutput.grammarAnalysis,
    transitionAnalysis: transOutput,
    promptAnalysis: megaOutput.promptAnalysis,
    duplicationAnalysis: megaOutput.duplicationAnalysis,
    coachSynthesis: coachOutput,
  };
}
