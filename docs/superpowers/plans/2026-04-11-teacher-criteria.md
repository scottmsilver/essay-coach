# Teacher Criteria Analysis Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add optional teacher criteria to essays — students paste or import a rubric, and a new Gemini analysis shows how their essay meets each criterion with annotations.

**Architecture:** New `analyzeCriteria` Cloud Function following the existing `createAnalysisHandler` pattern. Shared types in `shared/criteriaTypes.ts`, re-exported via `src/types.ts`. New `CriteriaPanel` component in the sidebar. Criteria stored on the essay doc, snapshots frozen per-draft for stable comparisons.

**Tech Stack:** React + Mantine (frontend), Firebase Cloud Functions + Gemini API (backend), Vitest (tests)

**Spec:** `docs/superpowers/specs/2026-04-11-teacher-criteria-design.md`

---

### Task 1: Shared Types

**Files:**
- Create: `shared/criteriaTypes.ts`
- Modify: `src/types.ts:75-77` (add re-export)
- Modify: `src/types.ts:85-86` (add to REPORT_KEYS)
- Modify: `src/types.ts:88-95` (add to REPORT_LABELS)
- Modify: `src/types.ts:113-133` (add to Draft interface)
- Modify: `src/types.ts:135-145` (add to Essay interface)

- [ ] **Step 1: Create `shared/criteriaTypes.ts`**

```typescript
export interface CriterionAnnotation {
  quotedText: string;
  comment: string;
}

export interface CriterionResult {
  criterion: string;
  status: 'met' | 'partially_met' | 'not_met';
  evidence: string;
  comment: string;
  annotations: CriterionAnnotation[];
}

export interface CriteriaComparison {
  improvements: Array<{ criterion: string; previous: 'met' | 'partially_met' | 'not_met'; current: 'met' | 'partially_met' | 'not_met' }>;
  regressions: Array<{ criterion: string; previous: 'met' | 'partially_met' | 'not_met'; current: 'met' | 'partially_met' | 'not_met' }>;
  unchanged: Array<{ criterion: string; status: 'met' | 'partially_met' | 'not_met' }>;
  newCriteria: string[];
  removedCriteria: string[];
  summary: string;
}

export interface CriteriaAnalysis {
  criteria: CriterionResult[];
  overallNarrative: string;
  comparisonToPrevious: CriteriaComparison | null;
}
```

- [ ] **Step 2: Add re-export to `src/types.ts`**

After line 77 (the duplication re-export), add:

```typescript
// Criteria analysis types — canonical definitions in shared/criteriaTypes.ts
import type { CriterionResult, CriteriaAnalysis, CriteriaComparison } from '../shared/criteriaTypes';
export type { CriterionResult, CriteriaAnalysis, CriteriaComparison };
```

- [ ] **Step 3: Add `'criteria'` to `REPORT_KEYS` and `REPORT_LABELS`**

Change `src/types.ts:85`:
```typescript
export const REPORT_KEYS = ['essay', 'overall', 'grammar', 'transitions', 'prompt', 'duplication', 'criteria'] as const;
```

Change `src/types.ts:88-95` to add:
```typescript
export const REPORT_LABELS: Record<ReportKey, string> = {
  essay: 'Essay',
  overall: 'Overall',
  grammar: 'Grammar',
  transitions: 'Transitions',
  prompt: 'Prompt Fit',
  duplication: 'Duplication',
  criteria: 'Criteria',
};
```

- [ ] **Step 4: Extend the `Draft` interface**

Add after `duplicationStatus` (line 127):

```typescript
  criteriaAnalysis?: CriteriaAnalysis | null;
  criteriaStatus?: EvaluationStatus | null;
  criteriaSnapshot?: string | null;
```

- [ ] **Step 5: Extend the `Essay` interface**

Add after `contentSource` (line 144):

```typescript
  teacherCriteria?: string | null;
  criteriaSource?: DocSource | null;
```

- [ ] **Step 6: Verify types compile**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors related to criteria types.

- [ ] **Step 7: Commit**

```bash
git add shared/criteriaTypes.ts src/types.ts
git commit -m "feat(types): add CriteriaAnalysis shared types and extend Draft/Essay interfaces"
```

---

### Task 2: Entity & Presentation Layer

**Files:**
- Modify: `src/entities/draftEntity.ts:3` (extend AnalysisKey)
- Modify: `src/entities/draftEntity.ts:18-24` (add to DATA_FIELDS)
- Modify: `src/entities/draftEntity.ts:26-32` (add to STATUS_FIELDS)
- Modify: `src/entities/draftEntity.ts:49-73` (add to issueCount)
- Modify: `src/entities/draftPresentation.ts:30` (add to REPORT_KEYS)
- Modify: `src/entities/draftPresentation.ts:35-54` (add criteria guard to resolveReportStatus)

- [ ] **Step 1: Extend `AnalysisKey` in `draftEntity.ts`**

Change line 3:
```typescript
export type AnalysisKey = 'overall' | 'grammar' | 'transitions' | 'prompt' | 'duplication' | 'criteria';
```

- [ ] **Step 2: Add to `DATA_FIELDS` and `STATUS_FIELDS`**

Add to `DATA_FIELDS` (after the duplication entry):
```typescript
  criteria: 'criteriaAnalysis',
```

Add to `STATUS_FIELDS` (after the duplication entry):
```typescript
  criteria: 'criteriaStatus',
```

- [ ] **Step 3: Add criteria case to `issueCount`**

Add after the `case 'duplication':` block (before the closing `}`):
```typescript
      case 'criteria':
        return raw.criteriaAnalysis
          ? raw.criteriaAnalysis.criteria.filter((c) => c.status !== 'met').length
          : undefined;
```

- [ ] **Step 4: Add to `draftPresentation.ts` REPORT_KEYS**

Change line 30:
```typescript
const REPORT_KEYS: AnalysisKey[] = ['overall', 'grammar', 'transitions', 'prompt', 'duplication', 'criteria'];
```

- [ ] **Step 5: Add criteria guard to `resolveReportStatus`**

Add after line 41 (`if (key === 'prompt' && !hasPrompt) return 'unavailable';`):
```typescript
  if (key === 'criteria' && !hasCriteria) return 'unavailable';
```

Update `resolveReportStatus` signature to accept `hasCriteria`:
```typescript
function resolveReportStatus(
  entity: DraftEntity,
  key: AnalysisKey,
  draftAge: number,
  hasPrompt: boolean,
  hasCriteria: boolean,
): ReportStatus {
```

Update `presentDraft` signature and the loop call:
```typescript
export function presentDraft(
  entity: DraftEntity,
  draftAge: number,
  hasPrompt: boolean,
  isLatest: boolean,
  _isOwner?: boolean,
  hasCriteria?: boolean,
): DraftPresentation {
  const reports = {} as Record<AnalysisKey, ReportPresentation>;

  for (const key of REPORT_KEYS) {
    reports[key] = {
      status: resolveReportStatus(entity, key, draftAge, hasPrompt, !!hasCriteria),
      issueCount: entity.issueCount(key),
      isRecommended: entity.recommendedReport === key,
      statusMessage: entity.statusMessage(key),
    };
  }
```

Also add `hasCriteria` to the `DraftPresentation` interface:
```typescript
export interface DraftPresentation {
  reports: Record<AnalysisKey, ReportPresentation>;
  verdict: VerdictPresentation;
  canEdit: boolean;
  hasPrompt: boolean;
  hasCriteria: boolean;
  isLatest: boolean;
}
```

And in the `presentDraft` return:
```typescript
  return {
    reports,
    verdict: resolveVerdict(entity, draftAge),
    canEdit: isLatest,
    hasPrompt,
    hasCriteria: !!hasCriteria,
    isLatest,
  };
```

- [ ] **Step 6: Update callers of `presentDraft`**

Search for all callers of `presentDraft` and pass `hasCriteria` (from `essay.teacherCriteria`). The caller is in `EssayPage.tsx` — this will be wired up in Task 6. For now, the parameter has a `?` default so existing callers won't break.

- [ ] **Step 7: Verify types compile**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 8: Commit**

```bash
git add src/entities/draftEntity.ts src/entities/draftPresentation.ts
git commit -m "feat(entities): add criteria to AnalysisKey, report presentation, and issue count"
```

---

### Task 3: Analysis Actions Hook

**Files:**
- Modify: `src/hooks/useAnalysisActions.ts:8` (extend ActionKey)
- Modify: `src/hooks/useAnalysisActions.ts:20-25` (add to ANALYSIS_CONFIG)
- Modify: `src/hooks/useAnalysisActions.ts:27-28` (add to INITIAL_LOADING/ERRORS)

- [ ] **Step 1: Extend `ActionKey`**

Change line 8:
```typescript
export type ActionKey = 'grammar' | 'transitions' | 'prompt' | 'duplication' | 'criteria';
```

- [ ] **Step 2: Add to `ANALYSIS_CONFIG`**

Add after the duplication entry (line 24):
```typescript
  criteria: { fn: 'analyzeCriteria', dataField: 'criteriaAnalysis', statusField: 'criteriaStatus' },
```

- [ ] **Step 3: Add to initial state records**

Change line 27:
```typescript
const INITIAL_LOADING: Record<ActionKey, boolean> = { grammar: false, transitions: false, prompt: false, duplication: false, criteria: false };
```

Change line 28:
```typescript
const INITIAL_ERRORS: Record<ActionKey, string | null> = { grammar: null, transitions: null, prompt: null, duplication: null, criteria: null };
```

- [ ] **Step 4: Verify types compile**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useAnalysisActions.ts
git commit -m "feat(hooks): add criteria to analysis actions config"
```

---

### Task 4: Backend — Criteria Analysis Module

**Files:**
- Create: `functions/src/criteria.ts`
- Create: `functions/src/analyzeCriteria.ts`
- Modify: `functions/src/index.ts:17` (add export)

- [ ] **Step 1: Create `functions/src/criteria.ts`**

This is the core analysis module following the exact pattern of `functions/src/grammar.ts`.

```typescript
import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';

// ── Types (canonical definitions in shared/criteriaTypes.ts) ──────────────
export type { CriterionResult, CriteriaAnalysis, CriteriaComparison } from '../../shared/criteriaTypes';
import type { CriteriaAnalysis } from '../../shared/criteriaTypes';

// ── System Prompt ──────────────────────────────────��─────────────────────

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

// ── Gemini Response Schema ──────────────────────────────���────────────────

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

// ── Prompt Builder ───────────────────────────────��───────────────────────

interface CriteriaInput {
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

// ── Gemini Call ──────────────────────────────────────────────────────��───

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
```

- [ ] **Step 2: Create `functions/src/analyzeCriteria.ts`**

Follows the `analyzePromptAdherence.ts` pattern (needs essay doc data, skips if no criteria):

```typescript
import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { analyzeCriteriaWithGemini, type CriteriaAnalysis } from './criteria';
import { resolveDocSource } from './gdocResolver';
import { defineSecret } from 'firebase-functions/params';

const gdocWebAppId = defineSecret('GDOC_WEB_APP_ID');

class AnalysisSkipped extends Error {
  constructor() { super('skipped'); }
}

async function analyzeCriteriaForDraft(ctx: AnalysisContext): Promise<CriteriaAnalysis> {
  const essayRef = ctx.draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const essayData = essaySnap.data();
  let teacherCriteria = essayData?.teacherCriteria;

  if (!teacherCriteria?.trim()) {
    await ctx.draftRef.update({ criteriaStatus: null });
    throw new AnalysisSkipped();
  }

  // Re-fetch criteria from Google Docs if imported (same pattern as evaluateEssay)
  const webAppId = gdocWebAppId.value();
  if (webAppId && essayData?.criteriaSource) {
    try {
      teacherCriteria = await resolveDocSource(essayData.criteriaSource, webAppId);
      await essayRef.update({ teacherCriteria });
    } catch (err) {
      console.warn('Failed to re-fetch criteria from Google Docs, using stored criteria:', (err as Error).message);
    }
  }

  // Build input with essay context
  const input: Parameters<typeof analyzeCriteriaWithGemini>[1] = {
    teacherCriteria,
    assignmentPrompt: essayData?.assignmentPrompt || '',
    writingType: essayData?.writingType || 'argumentative',
    content: ctx.content,
  };

  // For resubmissions, load previous criteria analysis and snapshot
  const draftNumber = ctx.draftData.draftNumber || 1;
  if (draftNumber > 1) {
    const prevDrafts = await ctx.draftRef.parent
      .where('draftNumber', '==', draftNumber - 1)
      .limit(1)
      .get();
    if (!prevDrafts.empty) {
      const prevData = prevDrafts.docs[0].data();
      if (prevData.criteriaAnalysis) {
        input.previousCriteriaAnalysis = JSON.stringify(prevData.criteriaAnalysis);
      }
      if (prevData.criteriaSnapshot) {
        input.previousCriteriaSnapshot = prevData.criteriaSnapshot;
      }
    }
  }

  const result = await analyzeCriteriaWithGemini(ctx.apiKey, input, ctx.draftRef);

  // Write the criteria snapshot alongside the analysis
  await ctx.draftRef.update({ criteriaSnapshot: teacherCriteria });

  return result;
}

export const analyzeCriteria = createAnalysisHandler<CriteriaAnalysis>({
  name: 'criteria',
  dataField: 'criteriaAnalysis',
  statusField: 'criteriaStatus',
  analyze: analyzeCriteriaForDraft,
  logSummary: (result) => ({
    totalCriteria: result.criteria.length,
    met: result.criteria.filter((c) => c.status === 'met').length,
    notMet: result.criteria.filter((c) => c.status === 'not_met').length,
  }),
});
```

- [ ] **Step 3: Export from `functions/src/index.ts`**

Add after line 17 (`export { analyzeDuplication }`):
```typescript
export { analyzeCriteria } from './analyzeCriteria';
```

- [ ] **Step 4: Verify backend compiles**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add functions/src/criteria.ts functions/src/analyzeCriteria.ts functions/src/index.ts
git commit -m "feat(functions): add analyzeCriteria Cloud Function with prompt, schema, and handler"
```

---

### Task 5: Firing Logic — Client & Server

**Files:**
- Modify: `src/utils/submitEssay.ts:10-21` (add criteria to fireAllAnalyses)
- Modify: `functions/src/onDraftCreated.ts:82-202` (add criteria after mega mode)
- Modify: `functions/src/onDraftCreated.ts:226-308` (add criteria to standalone path)

- [ ] **Step 1: Add criteria to `fireAllAnalyses`**

In `src/utils/submitEssay.ts`, add the criteria callable after the prompt adherence line (line 14). The function should conditionally fire only when `teacherCriteria` is provided. Update the function signature:

```typescript
export function fireAllAnalyses(essayId: string, draftId: string, ownerUid?: string, teacherCriteria?: string | null) {
  const evaluate = httpsCallable(functions, 'evaluateEssay', { timeout: FUNCTION_TIMEOUT });
  const grammar = httpsCallable(functions, 'analyzeGrammar', { timeout: FUNCTION_TIMEOUT });
  const transitions = httpsCallable(functions, 'analyzeTransitions', { timeout: FUNCTION_TIMEOUT });
  const promptAdherence = httpsCallable(functions, 'analyzePromptAdherence', { timeout: FUNCTION_TIMEOUT });

  const args = { essayId, draftId, ownerUid };
  evaluate(args).catch((err) => console.error('Evaluation failed:', err));
  grammar(args).catch((err) => console.error('Grammar failed:', err));
  transitions(args).catch((err) => console.error('Transitions failed:', err));
  promptAdherence(args).catch((err) => console.error('Prompt adherence failed:', err));

  if (teacherCriteria?.trim()) {
    const criteria = httpsCallable(functions, 'analyzeCriteria', { timeout: FUNCTION_TIMEOUT });
    criteria(args).catch((err) => console.error('Criteria analysis failed:', err));
  }
}
```

- [ ] **Step 2: Update `fireAllAnalyses` callers**

In `src/pages/NewEssayPage.tsx`, find the `fireAllAnalyses` call (around line 140) and pass the criteria:
```typescript
fireAllAnalyses(essayRef.id, draftRef.id, undefined, teacherCriteria);
```

- [ ] **Step 3: Add criteria to `onDraftCreated` mega mode path**

In `functions/src/onDraftCreated.ts`, add the criteria import at the top:
```typescript
import { analyzeCriteriaWithGemini } from './criteria';
```

After the mega mode success block (after line 151 `return;`), but before the `return`, add criteria firing. Since criteria is NOT part of the mega prompt, fire it as a separate call after mega writes. Replace the `return;` at line 152 with:

```typescript
        // Criteria analysis runs separately from mega — fire if criteria exist
        const teacherCriteria = essayData?.teacherCriteria;
        if (teacherCriteria?.trim()) {
          try {
            const criteriaInput = {
              teacherCriteria,
              assignmentPrompt,
              writingType,
              content,
              previousCriteriaAnalysis: undefined as string | undefined,
              previousCriteriaSnapshot: undefined as string | undefined,
            };
            if (draftNumber > 1) {
              const prevDrafts = await draftRef.parent.where('draftNumber', '==', draftNumber - 1).limit(1).get();
              if (!prevDrafts.empty) {
                const prevData = prevDrafts.docs[0].data();
                if (prevData.criteriaAnalysis) criteriaInput.previousCriteriaAnalysis = JSON.stringify(prevData.criteriaAnalysis);
                if (prevData.criteriaSnapshot) criteriaInput.previousCriteriaSnapshot = prevData.criteriaSnapshot;
              }
            }
            const criteriaResult = await analyzeCriteriaWithGemini(geminiApiKey.value(), criteriaInput, draftRef);
            await draftRef.update({ criteriaAnalysis: criteriaResult, criteriaStatus: null, criteriaSnapshot: teacherCriteria });
            logger.info('Criteria analysis complete (post-mega)', { essayId, draftId });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('Criteria analysis failed (post-mega)', { error: msg, essayId, draftId });
            await draftRef.update({ criteriaStatus: { stage: 'error', message: 'Criteria analysis failed' } });
          }
        }
        return;
```

- [ ] **Step 4: Add criteria to standalone fallback path**

In the standalone path (after the prompt adherence block, around line 308), add:

```typescript
    // Criteria analysis: conditional on teacher criteria existing
    if (!isActivelyProcessing(data.criteriaStatus) && !data.criteriaAnalysis) {
      const essayRef = draftRef.parent.parent!;
      const essaySnap = await essayRef.get();
      const teacherCriteria = essaySnap.data()?.teacherCriteria;

      if (teacherCriteria?.trim()) {
        logger.info('Criteria analysis not actively processing — trigger firing', { essayId, draftId });
        tasks.push(
          (async () => {
            try {
              const essayData = essaySnap.data()!;
              const criteriaInput: Parameters<typeof analyzeCriteriaWithGemini>[1] = {
                teacherCriteria,
                assignmentPrompt: essayData.assignmentPrompt || '',
                writingType: essayData.writingType || 'argumentative',
                content,
              };
              const draftNumber = data.draftNumber || 1;
              if (draftNumber > 1) {
                const prevDrafts = await draftRef.parent.where('draftNumber', '==', draftNumber - 1).limit(1).get();
                if (!prevDrafts.empty) {
                  const prevData = prevDrafts.docs[0].data();
                  if (prevData.criteriaAnalysis) criteriaInput.previousCriteriaAnalysis = JSON.stringify(prevData.criteriaAnalysis);
                  if (prevData.criteriaSnapshot) criteriaInput.previousCriteriaSnapshot = prevData.criteriaSnapshot;
                }
              }
              const analysis = await analyzeCriteriaWithGemini(apiKey, criteriaInput, draftRef);
              await draftRef.update({ criteriaAnalysis: analysis, criteriaStatus: null, criteriaSnapshot: teacherCriteria });
              logger.info('Trigger criteria analysis complete', { essayId, draftId });
            } catch (error: unknown) {
              const msg = error instanceof Error ? error.message : String(error);
              logger.error('Trigger criteria analysis failed', { error: msg, essayId, draftId });
              await draftRef.update({ criteriaStatus: { stage: 'error', message: 'Criteria analysis failed' } });
            }
          })()
        );
      }
    }
```

- [ ] **Step 5: Verify backend compiles**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/utils/submitEssay.ts functions/src/onDraftCreated.ts
git commit -m "feat(firing): add criteria analysis to fireAllAnalyses and onDraftCreated fallback"
```

---

### Task 6: NewEssayPage — Criteria Input Field

**Files:**
- Modify: `src/pages/NewEssayPage.tsx` (add state, textarea, GDoc import, submit handler)

- [ ] **Step 1: Add state variables**

After the existing state declarations (around line 28), add:
```typescript
const [teacherCriteria, setTeacherCriteria] = useState('');
const [criteriaSource, setCriteriaSource] = useState<DocSource | null>(null);
```

- [ ] **Step 2: Update `importTarget` type**

The existing `importTarget` is typed as `'prompt' | 'essay' | null`. Extend it:
```typescript
const [importTarget, setImportTarget] = useState<'prompt' | 'essay' | 'criteria' | null>(null);
```

- [ ] **Step 3: Update `handleImport` to handle criteria**

In the `handleImport` callback (around line 35-45), add a case for `'criteria'`:
```typescript
if (importTarget === 'criteria') {
  setTeacherCriteria(text);
  setCriteriaSource(source);
}
```

- [ ] **Step 4: Add the textarea between Assignment Prompt and Title**

After the assignment prompt section (after line ~186) and before the title input, add:

```tsx
{/* Teacher Criteria (optional) */}
<Textarea
  label={
    <Group justify="space-between" w="100%">
      <span>Teacher Criteria <span style={{ color: 'var(--mantine-color-dimmed)', fontWeight: 400 }}>(optional)</span></span>
      {criteriaSource ? (
        <Group gap="xs">
          <Badge size="xs" variant="light">Imported from Google Docs</Badge>
          <ActionIcon size="xs" variant="subtle" onClick={() => setImportTarget('criteria')}>
            <IconPencil size={12} />
          </ActionIcon>
          <ActionIcon size="xs" variant="subtle" onClick={() => { setTeacherCriteria(''); setCriteriaSource(null); }}>
            <IconX size={12} />
          </ActionIcon>
        </Group>
      ) : (
        <Button
          variant="subtle"
          size="compact-xs"
          leftSection={<IconFileImport size={14} />}
          onClick={() => setImportTarget('criteria')}
        >
          Import from Google Docs
        </Button>
      )}
    </Group>
  }
  placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
  value={teacherCriteria}
  onChange={(e) => setTeacherCriteria(e.currentTarget.value)}
  onPaste={(e) => handleRichPaste(e, setTeacherCriteria)}
  readOnly={!!criteriaSource}
  autosize
  minRows={3}
  maxRows={8}
/>
```

- [ ] **Step 5: Update `handleSubmit` to write criteria to essay doc**

In the `setDoc` call for the essay (around line 116-125), add the criteria fields:
```typescript
teacherCriteria: teacherCriteria.trim() || null,
criteriaSource: criteriaSource,
```

- [ ] **Step 6: Update GDocImportDialog label prop**

Update the `label` prop on the `GDocImportDialog` component (around line 248) to handle the new target:
```typescript
label={importTarget === 'prompt' ? 'prompt' : importTarget === 'criteria' ? 'criteria' : 'essay'}
```

- [ ] **Step 7: Verify frontend compiles**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 8: Commit**

```bash
git add src/pages/NewEssayPage.tsx
git commit -m "feat(ui): add optional Teacher Criteria field to NewEssayPage with GDoc import"
```

---

### Task 7: CriteriaPanel Component

**Files:**
- Create: `src/components/CriteriaPanel.tsx`

- [ ] **Step 1: Create the component**

```tsx
import { Badge, Card, Group, Stack, Text, ActionIcon, Modal, Textarea, Button } from '@mantine/core';
import { IconPencil, IconFileImport, IconX } from '@tabler/icons-react';
import { useState } from 'react';
import type { CriteriaAnalysis, DocSource } from '../types';
import { GDocImportDialog } from './GDocImportDialog';
import { handleRichPaste } from '../utils/pasteHandler';

interface CriteriaPanelProps {
  analysis: CriteriaAnalysis;
  teacherCriteria: string;
  criteriaSource: DocSource | null;
  isOwner: boolean;
  onSaveCriteria: (text: string, source: DocSource | null) => void;
}

const STATUS_COLORS: Record<string, string> = {
  met: 'green',
  partially_met: 'yellow',
  not_met: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  met: 'Met',
  partially_met: 'Partial',
  not_met: 'Not Met',
};

export function CriteriaPanel({ analysis, teacherCriteria, criteriaSource, isOwner, onSaveCriteria }: CriteriaPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState(teacherCriteria);
  const [editSource, setEditSource] = useState<DocSource | null>(criteriaSource);
  const [importOpen, setImportOpen] = useState(false);

  const handleSave = () => {
    onSaveCriteria(editText, editSource);
    setEditOpen(false);
  };

  const handleImport = (text: string, source: DocSource) => {
    setEditText(text);
    setEditSource(source);
    setImportOpen(false);
  };

  const metCount = analysis.criteria.filter((c) => c.status === 'met').length;
  const totalCount = analysis.criteria.length;

  return (
    <Stack gap="md">
      {/* Header with edit button */}
      <Group justify="space-between">
        <Text size="sm" c="dimmed">{metCount} of {totalCount} criteria met</Text>
        {isOwner && (
          <ActionIcon variant="subtle" size="sm" onClick={() => { setEditText(teacherCriteria); setEditSource(criteriaSource); setEditOpen(true); }}>
            <IconPencil size={14} />
          </ActionIcon>
        )}
      </Group>

      {/* Overall narrative */}
      <Card withBorder p="sm">
        <Text size="sm">{analysis.overallNarrative}</Text>
      </Card>

      {/* Comparison section (resubmissions) */}
      {analysis.comparisonToPrevious && (
        <Card withBorder p="sm">
          <Text size="sm" fw={600} mb="xs">Changes from Previous Draft</Text>
          <Text size="sm">{analysis.comparisonToPrevious.summary}</Text>
          {analysis.comparisonToPrevious.improvements.length > 0 && (
            <Group gap="xs" mt="xs">
              <Badge size="xs" color="green">Improved</Badge>
              <Text size="xs">{analysis.comparisonToPrevious.improvements.map((i) => i.criterion).join(', ')}</Text>
            </Group>
          )}
          {analysis.comparisonToPrevious.regressions.length > 0 && (
            <Group gap="xs" mt="xs">
              <Badge size="xs" color="red">Regressed</Badge>
              <Text size="xs">{analysis.comparisonToPrevious.regressions.map((r) => r.criterion).join(', ')}</Text>
            </Group>
          )}
        </Card>
      )}

      {/* Criteria checklist */}
      {analysis.criteria.map((criterion, idx) => (
        <Card key={idx} withBorder p="sm">
          <Group gap="xs" mb="xs">
            <Badge size="sm" color={STATUS_COLORS[criterion.status]}>{STATUS_LABELS[criterion.status]}</Badge>
            <Text size="sm" fw={600} style={{ flex: 1 }}>{criterion.criterion}</Text>
            {criterion.annotations.length > 0 && (
              <Badge size="xs" variant="light">{criterion.annotations.length} annotation{criterion.annotations.length !== 1 ? 's' : ''}</Badge>
            )}
          </Group>
          <Text size="sm" c="dimmed" mb="xs">{criterion.evidence}</Text>
          <Text size="sm">{criterion.comment}</Text>
        </Card>
      ))}

      {/* Edit modal */}
      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Edit Teacher Criteria" size="lg">
        <Stack gap="md">
          <Group justify="flex-end">
            {editSource ? (
              <Group gap="xs">
                <Badge size="xs" variant="light">Imported from Google Docs</Badge>
                <ActionIcon size="xs" variant="subtle" onClick={() => setImportOpen(true)}>
                  <IconPencil size={12} />
                </ActionIcon>
                <ActionIcon size="xs" variant="subtle" onClick={() => { setEditText(''); setEditSource(null); }}>
                  <IconX size={12} />
                </ActionIcon>
              </Group>
            ) : (
              <Button variant="subtle" size="compact-xs" leftSection={<IconFileImport size={14} />} onClick={() => setImportOpen(true)}>
                Import from Google Docs
              </Button>
            )}
          </Group>
          <Textarea
            placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
            value={editText}
            onChange={(e) => setEditText(e.currentTarget.value)}
            onPaste={(e) => handleRichPaste(e, setEditText)}
            readOnly={!!editSource}
            autosize
            minRows={6}
            maxRows={15}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save & Re-analyze</Button>
          </Group>
        </Stack>
        <GDocImportDialog
          opened={importOpen}
          onClose={() => setImportOpen(false)}
          onImport={handleImport}
          label="criteria"
        />
      </Modal>
    </Stack>
  );
}
```

- [ ] **Step 2: Create the empty state component**

Add to the same file (or as an export):

```tsx
export function CriteriaEmptyState({ isOwner, onAdd }: { isOwner: boolean; onAdd: () => void }) {
  return (
    <Stack align="center" justify="center" gap="md" py="xl">
      <Text size="sm" c="dimmed" ta="center">
        No teacher criteria provided.{' '}
        {isOwner ? 'Add your teacher\'s rubric to see how your essay measures up.' : ''}
      </Text>
      {isOwner && (
        <Button variant="light" onClick={onAdd}>Add Criteria</Button>
      )}
    </Stack>
  );
}
```

- [ ] **Step 3: Verify frontend compiles**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/CriteriaPanel.tsx
git commit -m "feat(ui): add CriteriaPanel component with checklist, comparison, and edit modal"
```

---

### Task 8: EssayPage — Wire Up Criteria View

**Files:**
- Modify: `src/pages/EssayPage.tsx` (add ViewMode, route, rendering, annotation switching, criteria edit handler)

- [ ] **Step 1: Add `'criteria'` to `ViewMode`**

Change the type at line 33:
```typescript
type ViewMode = 'essay' | 'overall' | 'transitions' | 'grammar' | 'prompt' | 'duplication' | 'criteria';
```

- [ ] **Step 2: Add to `viewFromPath`**

In the `viewFromPath` function (lines 35-42), add before the default return:
```typescript
if (pathname.endsWith('/criteria')) return 'criteria';
```

- [ ] **Step 3: Add criteria to the ensure guard in `handleDrawerSelectReport`**

In the handler (around line 124-134), add `'criteria'` to the union check that triggers `actions.ensure()`:
```typescript
if (view === 'transitions' || view === 'grammar' || view === 'prompt' || view === 'duplication' || view === 'criteria') {
  actions.ensure(view);
}
```

- [ ] **Step 4: Add the criteria view rendering block**

In the view rendering section (around line 411-473), add after the duplication block:

```tsx
{activeView === 'criteria' && (
  essay.teacherCriteria ? (
    <AnalysisPanel
      data={activeDraft.criteriaAnalysis}
      error={actions.errors.criteria}
      loading={actions.loading.criteria}
      status={activeDraft.criteriaStatus}
      onRetry={() => { actions.ensure('criteria'); }}
      onRerun={() => { actions.rerun('criteria'); }}
      rerunLoading={actions.loading.criteria}
      defaultMessage="Analyzing criteria..."
      placeholder="Criteria analysis is loading..."
    >
      <CriteriaPanel
        analysis={activeDraft.criteriaAnalysis!}
        teacherCriteria={essay.teacherCriteria}
        criteriaSource={essay.criteriaSource ?? null}
        isOwner={isOwner}
        onSaveCriteria={handleSaveCriteria}
      />
    </AnalysisPanel>
  ) : (
    <CriteriaEmptyState isOwner={isOwner} onAdd={() => setShowCriteriaEdit(true)} />
  )
)}
```

- [ ] **Step 5: Add the criteria edit handler and state**

Add state:
```typescript
const [showCriteriaEdit, setShowCriteriaEdit] = useState(false);
```

Add handler:
```typescript
const handleSaveCriteria = useCallback(async (text: string, source: DocSource | null) => {
  if (!essayId || !user) return;
  const uid = ownerUid ?? user.uid;
  const essayRef = doc(db, 'users', uid, 'essays', essayId);
  await updateDoc(essayRef, {
    teacherCriteria: text.trim() || null,
    criteriaSource: source,
  });
  // Clear criteria analysis on current draft to trigger re-analysis
  if (activeDraft) {
    const draftRef = doc(db, 'users', uid, 'essays', essayId, 'drafts', activeDraft.id);
    await updateDoc(draftRef, {
      criteriaAnalysis: null,
      criteriaStatus: null,
      criteriaSnapshot: null,
    });
  }
}, [essayId, user, ownerUid, activeDraft]);
```

- [ ] **Step 6: Pass `hasCriteria` to `presentDraft`**

Find where `presentDraft` is called and add the `hasCriteria` argument:
```typescript
presentDraft(entity, draftAge, hasPrompt, isLatest, isOwner, !!essay.teacherCriteria)
```

- [ ] **Step 7: Add imports**

Add to the imports at the top of the file:
```typescript
import { CriteriaPanel, CriteriaEmptyState } from '../components/CriteriaPanel';
```

- [ ] **Step 8: Verify frontend compiles**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 9: Commit**

```bash
git add src/pages/EssayPage.tsx
git commit -m "feat(ui): wire up criteria view in EssayPage with routing, rendering, and edit handler"
```

---

### Task 9: CoachDrawer — Always-Visible Criteria Nav Entry

**Files:**
- Modify: `src/components/CoachDrawer.tsx` (criteria is already in REPORT_KEYS from Task 1, but needs to always show)

- [ ] **Step 1: Update the reportKeys filter**

In `CoachDrawer.tsx` (around line 37-39), the filter currently excludes `'essay'` and conditionally excludes `'prompt'`. Update it so `'criteria'` is always included (never filtered out). The existing `REPORT_KEYS` and `REPORT_LABELS` already include `'criteria'` from Task 1, so the nav item will render automatically.

If there's a filter like `if (key === 'prompt' && !presentation.hasPrompt)`, ensure criteria is NOT filtered by `hasCriteria` — it always shows. The `unavailable` report status from the presentation layer handles the visual treatment (greyed out or showing empty state on click).

- [ ] **Step 2: Verify frontend compiles and nav renders**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors. "Criteria" should appear in the sidebar for all essays.

- [ ] **Step 3: Commit**

```bash
git add src/components/CoachDrawer.tsx
git commit -m "feat(ui): ensure Criteria nav entry is always visible in CoachDrawer"
```

---

### Task 10: Annotation Generalization

**Files:**
- Modify: `src/utils.ts` (add criteria annotation collector)
- Modify: `src/pages/EssayPage.tsx` (switch annotation source based on active view)

- [ ] **Step 1: Add criteria annotation types and collector to `src/utils.ts`**

Add after the existing `classifyAnnotation` function (line 18):

```typescript
export interface CriteriaAnnotation {
  quotedText: string;
  comment: string;
  criterionIndex: number;
  criterionText: string;
}

export function collectCriteriaAnnotations(analysis: CriteriaAnalysis): CriteriaAnnotation[] {
  const result: CriteriaAnnotation[] = [];
  for (let i = 0; i < analysis.criteria.length; i++) {
    const criterion = analysis.criteria[i];
    for (const ann of criterion.annotations) {
      result.push({
        ...ann,
        criterionIndex: i,
        criterionText: criterion.criterion,
      });
    }
  }
  return result;
}
```

Add the import at the top:
```typescript
import type { Evaluation, TraitAnnotation, CriteriaAnalysis } from './types';
```

- [ ] **Step 2: Switch annotation source in `EssayPage.tsx`**

In the essay view rendering, where `allAnnotations` is computed (around line 118-121), make it view-dependent:

```typescript
const allAnnotations = useMemo(() => {
  if (activeView === 'criteria' && activeDraft?.criteriaAnalysis) {
    return collectCriteriaAnnotations(activeDraft.criteriaAnalysis);
  }
  if (activeView === 'overall' && activeDraft?.evaluation) {
    return collectAnnotations(activeDraft.evaluation);
  }
  return [];
}, [activeView, activeDraft]);
```

Add the import:
```typescript
import { collectAnnotations, collectCriteriaAnnotations } from '../utils';
```

- [ ] **Step 3: Update the essay text panel to handle both annotation types**

The essay text panel renders annotations with trait-based labels and colors. It needs to handle the `CriteriaAnnotation` type too. The exact change depends on how `AnnotatedEssay` (or equivalent) renders annotations. At minimum, the annotation display needs to:
- Accept either `TraitAnnotation[]` or `CriteriaAnnotation[]`
- For criteria annotations: use criterion index for color and criterion text for label
- Use a secondary color palette that doesn't collide with trait colors

This step may require reading `AnnotatedEssay` or equivalent component and adjusting its props. The key principle: annotations are view-scoped (criteria view shows only criteria annotations, overall view shows only trait annotations).

- [ ] **Step 4: Verify frontend compiles**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts src/pages/EssayPage.tsx
git commit -m "feat(annotations): generalize annotation pipeline for criteria view"
```

---

### Task 11: Backend Tests

**Files:**
- Create: `functions/tests/criteria.test.ts`

- [ ] **Step 1: Write tests for `buildCriteriaPrompt`**

```typescript
import { describe, it, expect } from 'vitest';
import { buildCriteriaPrompt } from '../src/criteria';

describe('buildCriteriaPrompt', () => {
  const baseInput = {
    teacherCriteria: '1. Clear thesis statement\n2. Three supporting paragraphs\n3. Proper MLA citations',
    assignmentPrompt: 'Write an argumentative essay about climate change.',
    writingType: 'argumentative',
    content: 'Climate change is a pressing issue...',
  };

  it('builds a first-submission prompt with no comparison section', () => {
    const prompt = buildCriteriaPrompt(baseInput);
    expect(prompt).toContain('## Teacher\'s Criteria');
    expect(prompt).toContain('Clear thesis statement');
    expect(prompt).toContain('## Assignment Prompt');
    expect(prompt).toContain('## Student Essay');
    expect(prompt).toContain('Set "comparisonToPrevious" to null');
    expect(prompt).not.toContain('Previous Criteria Analysis');
  });

  it('builds a resubmission prompt with previous analysis', () => {
    const prompt = buildCriteriaPrompt({
      ...baseInput,
      previousCriteriaAnalysis: '{"criteria":[]}',
    });
    expect(prompt).toContain('## Previous Criteria Analysis');
    expect(prompt).toContain('Include the "comparisonToPrevious" field');
  });

  it('includes previous snapshot when criteria changed', () => {
    const prompt = buildCriteriaPrompt({
      ...baseInput,
      previousCriteriaAnalysis: '{"criteria":[]}',
      previousCriteriaSnapshot: 'Old criteria that was different',
    });
    expect(prompt).toContain('## Previous Criteria Text');
    expect(prompt).toContain('Old criteria that was different');
  });

  it('omits previous snapshot section when criteria unchanged', () => {
    const prompt = buildCriteriaPrompt({
      ...baseInput,
      previousCriteriaAnalysis: '{"criteria":[]}',
      previousCriteriaSnapshot: baseInput.teacherCriteria,
    });
    expect(prompt).not.toContain('## Previous Criteria Text');
  });
});
```

- [ ] **Step 2: Run the tests**

Run: `cd /home/ssilver/development/essay-grader/functions && npx vitest run tests/criteria.test.ts`
Expected: All 4 tests pass.

- [ ] **Step 3: Commit**

```bash
git add functions/tests/criteria.test.ts
git commit -m "test: add unit tests for buildCriteriaPrompt"
```

---

### Task 12: Frontend Entity Tests

**Files:**
- Modify: `src/entities/draftEntity.test.ts` (add criteria test cases)

- [ ] **Step 1: Add criteria issueCount test**

Add a test case to the existing `draftEntity.test.ts`:

```typescript
it('counts not-met and partially-met criteria as issues', () => {
  const entity = createDraftEntity({
    ...baseDraft,
    criteriaAnalysis: {
      criteria: [
        { criterion: 'Thesis', status: 'met', evidence: '', comment: '', annotations: [] },
        { criterion: 'Evidence', status: 'partially_met', evidence: '', comment: '', annotations: [] },
        { criterion: 'Citations', status: 'not_met', evidence: '', comment: '', annotations: [] },
      ],
      overallNarrative: '',
      comparisonToPrevious: null,
    },
  });
  expect(entity.issueCount('criteria')).toBe(2);
});

it('returns undefined issueCount when no criteria analysis', () => {
  const entity = createDraftEntity(baseDraft);
  expect(entity.issueCount('criteria')).toBeUndefined();
});
```

- [ ] **Step 2: Run the tests**

Run: `cd /home/ssilver/development/essay-grader && npx vitest run src/entities/draftEntity.test.ts`
Expected: All tests pass including the new criteria cases.

- [ ] **Step 3: Commit**

```bash
git add src/entities/draftEntity.test.ts
git commit -m "test: add criteria issueCount tests to draftEntity"
```

---

### Task 13: Deploy & Smoke Test

**Files:**
- No new files — deployment and manual verification

- [ ] **Step 1: Deploy the new function**

```bash
cd /home/ssilver/development/essay-grader/functions
./scripts/smart-deploy.sh
```

- [ ] **Step 2: Smoke test — create an essay with criteria**

1. Open the app
2. Create a new essay with writing type "argumentative"
3. Paste criteria in the Teacher Criteria field: "1. Clear thesis statement in intro\n2. At least three body paragraphs\n3. Counter-argument addressed\n4. Proper conclusion"
4. Paste or type a test essay
5. Submit
6. Verify: "Criteria" appears in sidebar, analysis runs, shows met/partial/not-met for each criterion

- [ ] **Step 3: Smoke test — edit criteria after submission**

1. Click the pencil icon in the Criteria panel
2. Change the criteria text
3. Save
4. Verify: analysis clears and re-runs with new criteria

- [ ] **Step 4: Smoke test — resubmission comparison**

1. Edit the essay content
2. Resubmit (re-analyze)
3. Navigate to Criteria tab on the new draft
4. Verify: comparison section shows improvements/regressions
