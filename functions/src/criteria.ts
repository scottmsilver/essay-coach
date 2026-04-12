import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';

// ── Types (canonical definitions in shared/criteriaTypes.ts) ──────────────
export type { CriterionResult, CriteriaAnalysis, CriteriaComparison } from '../../shared/criteriaTypes';
import type { CriteriaAnalysis } from '../../shared/criteriaTypes';

// ── System Prompt ────────────────────────────────────────────────────────

export const CRITERIA_SYSTEM_PROMPT = `You are an expert writing evaluator helping high school and college students understand how well their essay meets their teacher's specific criteria.

## Your job

You will receive:
1. A teacher's criteria (rubric, checklist, or requirements) in whatever format they provided
2. An assignment prompt (for context)
3. The student's essay
4. Optionally, a previous criteria analysis and previous criteria text (for resubmissions)

## How to evaluate

1. **Extract criteria:** Parse the teacher's input into discrete, evaluable criteria. If the teacher gave a numbered rubric, use those items. If they wrote a paragraph of expectations, break it into individual requirements. Each criterion should be a single evaluable claim.

2. **Evaluate each criterion independently:** For each one, determine:
   - **met**: The essay clearly satisfies this criterion with strong evidence
   - **partially_met**: The essay addresses this criterion but incompletely or weakly
   - **not_met**: The essay does not satisfy this criterion or barely touches it

3. **Provide evidence:** Quote or reference specific parts of the essay that support your judgment.

4. **Annotate the essay:** For each criterion, identify specific passages in the essay that are relevant. Quote the exact text. Your annotation comment should be Socratic — ask a guiding question that helps the student see how to improve, rather than telling them what to write.

5. **Write a coaching narrative:** Summarize how the essay measures up overall. Be encouraging but honest. Focus on what the student can do to improve.

## Annotation style

Follow the EssayCoach Socratic voice:
- Ask questions that guide the student to discover improvements themselves
- Never rewrite their text for them
- Be specific about what you observe, then ask what they could try
- Example: "Your thesis mentions three reasons, but I only see two developed in the body. Which of those three feels most important to you? What evidence could you add for it?"

## Resubmission comparison

If you receive a previous criteria analysis and previous criteria text:
- Compare the current evaluation to the previous one
- Note which criteria improved, regressed, or stayed the same
- If the criteria text changed between drafts, note new criteria and removed criteria
- Write a comparison summary highlighting progress

## Important rules

- Extract criteria faithfully from whatever format the teacher provided — do not invent criteria
- Evaluate based on what the essay actually says, not what you wish it said
- Quote text EXACTLY as it appears in the essay
- If the teacher's criteria are vague, interpret them reasonably and note your interpretation
- The assignment prompt is context only — evaluate against the teacher's criteria, not the prompt`;

// ── Gemini Response Schema ───────────────────────────────────────────────

const CRITERION_STATUS_ENUM = ['met', 'partially_met', 'not_met'];

const ANNOTATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    quotedText: { type: 'string' as const },
    comment: { type: 'string' as const },
  },
  required: ['quotedText', 'comment'],
};

const CRITERION_RESULT_SCHEMA = {
  type: 'object' as const,
  properties: {
    criterion: { type: 'string' as const },
    status: { type: 'string' as const, enum: CRITERION_STATUS_ENUM },
    evidence: { type: 'string' as const },
    comment: { type: 'string' as const },
    annotations: {
      type: 'array' as const,
      items: ANNOTATION_SCHEMA,
    },
  },
  required: ['criterion', 'status', 'evidence', 'comment', 'annotations'],
};

const COMPARISON_ITEM_SCHEMA = {
  type: 'object' as const,
  properties: {
    criterion: { type: 'string' as const },
    previous: { type: 'string' as const, enum: CRITERION_STATUS_ENUM },
    current: { type: 'string' as const, enum: CRITERION_STATUS_ENUM },
  },
  required: ['criterion', 'previous', 'current'],
};

const UNCHANGED_ITEM_SCHEMA = {
  type: 'object' as const,
  properties: {
    criterion: { type: 'string' as const },
    status: { type: 'string' as const, enum: CRITERION_STATUS_ENUM },
  },
  required: ['criterion', 'status'],
};

export const CRITERIA_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    criteria: {
      type: 'array' as const,
      items: CRITERION_RESULT_SCHEMA,
    },
    overallNarrative: { type: 'string' as const },
    comparisonToPrevious: {
      type: 'object' as const,
      nullable: true,
      properties: {
        improvements: { type: 'array' as const, items: COMPARISON_ITEM_SCHEMA },
        regressions: { type: 'array' as const, items: COMPARISON_ITEM_SCHEMA },
        unchanged: { type: 'array' as const, items: UNCHANGED_ITEM_SCHEMA },
        newCriteria: { type: 'array' as const, items: { type: 'string' as const } },
        removedCriteria: { type: 'array' as const, items: { type: 'string' as const } },
        summary: { type: 'string' as const },
      },
      required: ['improvements', 'regressions', 'unchanged', 'newCriteria', 'removedCriteria', 'summary'],
    },
  },
  required: ['criteria', 'overallNarrative', 'comparisonToPrevious'],
};

// ── Prompt Builder ───────────────────────────────────────────────────────

export interface CriteriaInput {
  teacherCriteria: string;
  assignmentPrompt: string;
  writingType: string;
  content: string;
  previousCriteriaAnalysis?: string;
  previousCriteriaSnapshot?: string;
}

export function buildCriteriaPrompt(input: CriteriaInput): string {
  let prompt = `Evaluate how well the following ${input.writingType} essay meets the teacher's criteria.

## Teacher's Criteria
${input.teacherCriteria}

## Assignment Prompt (for context)
${input.assignmentPrompt}

## Student Essay
${input.content}`;

  if (input.previousCriteriaAnalysis) {
    prompt += `

## Previous Criteria Analysis (for comparison)
${input.previousCriteriaAnalysis}`;
  }

  if (input.previousCriteriaSnapshot && input.previousCriteriaSnapshot !== input.teacherCriteria) {
    prompt += `

## Previous Criteria Text (criteria have changed since last analysis)
${input.previousCriteriaSnapshot}`;
  }

  prompt += `

Respond with a JSON object matching the schema. ${input.previousCriteriaAnalysis ? 'Include the "comparisonToPrevious" field.' : 'Set "comparisonToPrevious" to null (this is the first analysis).'} Do not include any text outside the JSON.`;

  return prompt;
}

// ── Gemini Call ──────────────────────────────────────────────────────────

export async function analyzeCriteriaWithGemini(
  apiKey: string,
  input: CriteriaInput,
  progressRef?: DocumentReference,
): Promise<CriteriaAnalysis> {
  const prompt = buildCriteriaPrompt(input);

  const outputText = await streamGeminiJson({
    apiKey,
    contents: prompt,
    systemInstruction: CRITERIA_SYSTEM_PROMPT,
    responseSchema: CRITERIA_ANALYSIS_SCHEMA,
    progressRef,
    statusField: 'criteriaStatus',
    generatingMessage: 'Analyzing criteria...',
  });

  return JSON.parse(outputText) as CriteriaAnalysis;
}
