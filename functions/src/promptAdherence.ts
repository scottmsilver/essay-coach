import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';

// ── Types (canonical definitions in shared/promptTypes.ts) ───────────────
export type { MatrixCell, MatrixRow, PromptMatrix, PromptQuestion, PromptAnalysis } from '../../shared/promptTypes';
import type { PromptAnalysis } from '../../shared/promptTypes';

// ── System Prompt ────────────────────────────────────────────────────────

export const PROMPT_ADHERENCE_SYSTEM_PROMPT = `You are an expert writing coach who analyzes whether a student's essay addresses all parts of an assignment prompt. Your job is to build a structured map of the prompt's requirements and show which ones the essay fulfills.

## Matrix Construction

Read the assignment prompt and identify its structural expectations — what combination of things the student must produce.

**Grid prompts** (cross-product structure):
- If the prompt defines a grid (e.g., "discuss 3 themes, supporting each with evidence from 2 books"), build a matrix with meaningful row and column labels.
- Rows represent one dimension (e.g., themes), columns represent another (e.g., books/sources).

**Flat prompts** (no cross-product):
- If the prompt is flat (e.g., "write an argumentative essay about climate change"), build a single-column matrix.
- Rows are the discrete requirements (take a position, provide evidence, address counterarguments, etc.).
- Set columns to [""] and columnLabel to "".

**Choice-based prompts** ("pick 2 of 5 books"):
- Read the essay to determine which choices the student made.
- Build the matrix around those choices only — don't penalize for unchosen options.

**Implicit requirements:**
- Extract both explicit requirements and implicit ones (e.g., an argumentative prompt implies a thesis even if not stated).
- Simple prompts ("Write about dogs") should still produce 2-3 rows based on genre expectations.
- Prompts with embedded rubrics: extract writing requirements, skip meta-criteria (point values, page lengths).

**Row labels:**
- Label rows concretely based on what the student actually wrote (e.g., "Theme: Corruption of the American Dream"), not abstractly ("Theme 1").
- If the student hasn't addressed a row at all, still label it concretely based on the prompt's expectations.

## Cell Assessment

- **filled** — essay substantively covers this cell with clear evidence. The student develops the point with specific details, quotes, or analysis.
- **partial** — essay touches on this but insufficiently. Mentioned without development, or surface-level treatment only.
- **empty** — essay doesn't address this cell at all.

**Evidence:** Quote EXACT text from the essay as evidence in each cell. For filled/partial cells, include the most relevant quote(s). For empty cells, leave evidence as an empty array.

## Questions

Separately extract all questions the prompt asks (explicit or implied):
- Direct questions ("How does Gatsby's past shape his present?")
- Implied questions from directives ("Compare X and Y" implies "What are the similarities and differences?")
- Skip trivial formatting questions ("Is the essay double-spaced?")

Assess whether each question is answered in the essay. Quote the exact evidence if addressed.

## Feedback Style

Use Socratic guidance throughout:
- For **empty** cells: ask guiding questions that help the student realize what's missing. "The prompt asks you to connect this theme to the novel — what scenes or quotes might support this?"
- For **partial** cells: acknowledge what's there and push deeper. "You mention this idea briefly — what specific evidence could you add to develop it fully?"
- For **filled** cells: explain briefly why it works so the student can replicate the technique. "Strong use of a direct quote tied to your analysis."
- NEVER rewrite the student's text.

## Summary

Provide an overall comment that gives the student a clear picture of their prompt coverage. Be encouraging about what's covered while being specific about gaps.`;

// ── Gemini Response Schema ───────────────────────────────────────────────

const MATRIX_CELL_SCHEMA = {
  type: 'object' as const,
  properties: {
    status: { type: 'string' as const, enum: ['filled', 'partial', 'empty'] },
    evidence: { type: 'array' as const, items: { type: 'string' as const } },
    comment: { type: 'string' as const },
  },
  required: ['status', 'evidence', 'comment'],
};

export const PROMPT_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    matrix: {
      type: 'object' as const,
      properties: {
        description: { type: 'string' as const },
        rowLabel: { type: 'string' as const },
        columnLabel: { type: 'string' as const },
        rows: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              label: { type: 'string' as const },
              cells: { type: 'array' as const, items: MATRIX_CELL_SCHEMA },
            },
            required: ['label', 'cells'],
          },
        },
        columns: { type: 'array' as const, items: { type: 'string' as const } },
      },
      required: ['description', 'rowLabel', 'columnLabel', 'rows', 'columns'],
    },
    questions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          questionText: { type: 'string' as const },
          addressed: { type: 'boolean' as const },
          evidence: { type: 'string' as const },
          comment: { type: 'string' as const },
        },
        required: ['questionText', 'addressed', 'evidence', 'comment'],
      },
    },
    summary: {
      type: 'object' as const,
      properties: {
        totalCells: { type: 'number' as const },
        filledCells: { type: 'number' as const },
        partialCells: { type: 'number' as const },
        emptyCells: { type: 'number' as const },
        overallComment: { type: 'string' as const },
      },
      required: ['totalCells', 'filledCells', 'partialCells', 'emptyCells', 'overallComment'],
    },
  },
  required: ['matrix', 'questions', 'summary'],
};

// ── Prompt Builder ───────────────────────────────────────────────────────

export function buildPromptAdherencePrompt(assignmentPrompt: string, content: string): string {
  return `Analyze how well this student essay addresses the assignment prompt. Build a requirements matrix showing which parts of the prompt are fulfilled, partially addressed, or missing.

## Assignment Prompt

${assignmentPrompt}

## Student Essay

---
${content}
---

Construct the matrix, extract questions, and provide a summary with Socratic feedback for each cell.`;
}

// ── Gemini Call ──────────────────────────────────────────────────────────

export async function analyzePromptWithGemini(
  apiKey: string,
  assignmentPrompt: string,
  content: string,
  progressRef?: DocumentReference,
): Promise<PromptAnalysis> {
  const prompt = buildPromptAdherencePrompt(assignmentPrompt, content);

  const outputText = await streamGeminiJson({
    apiKey,
    contents: prompt,
    systemInstruction: PROMPT_ADHERENCE_SYSTEM_PROMPT,
    responseSchema: PROMPT_ANALYSIS_SCHEMA,
    progressRef,
    statusField: 'promptStatus',
    generatingMessage: 'Analyzing prompt adherence...',
  });

  return JSON.parse(outputText) as PromptAnalysis;
}
