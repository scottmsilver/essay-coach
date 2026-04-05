# Mega-Prompt Consolidation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate 6 separate Gemini API calls into 1 mega-prompt call behind a feature flag, with the existing separate-call path preserved as fallback.

**Architecture:** Early-return guard in `onDraftCreated.ts` checks a Firestore feature flag. If enabled, calls `megaAnalyze()` which makes one Gemini call with a combined prompt/schema, splits the response, and writes to the same Firestore fields. If disabled or if mega fails, falls through to the existing parallel dispatch unchanged.

**Tech Stack:** TypeScript, Firebase Functions, `@google/genai`, Firestore

**Spec:** `docs/superpowers/specs/2026-04-04-mega-prompt-design.md`

---

### Task 1: Export Schemas from Analysis Modules

**Files:**
- Modify: `functions/src/grammar.ts:88` — add `export` to `GRAMMAR_ANALYSIS_SCHEMA`
- Modify: `functions/src/transitions.ts:42` — add `export` to `TRANSITION_SCHEMA`
- Modify: `functions/src/promptAdherence.ts:79` — add `export` to `PROMPT_ANALYSIS_SCHEMA`
- Modify: `functions/src/duplication.ts:69` — add `export` to `DUPLICATION_ANALYSIS_SCHEMA`
- Modify: `functions/src/synthesizeCoach.ts:31` — add `export` to `COACH_SYNTHESIS_SCHEMA`
- Modify: `functions/src/synthesizeCoach.ts:6` — add `export` to `COACH_SYNTHESIS_SYSTEM`

Note: `EVALUATION_SCHEMA` in `gemini.ts` is already exported (done in eval framework work). `SYSTEM_PROMPT` in `prompt.ts` is already exported.

- [ ] **Step 1: Add `export` to `GRAMMAR_SYSTEM_PROMPT` and `GRAMMAR_ANALYSIS_SCHEMA`**

In `functions/src/grammar.ts` line 10, change:
```typescript
const GRAMMAR_SYSTEM_PROMPT = `You are an expert
```
to:
```typescript
export const GRAMMAR_SYSTEM_PROMPT = `You are an expert
```

And line 88, change:
```typescript
const GRAMMAR_ANALYSIS_SCHEMA = {
```
to:
```typescript
export const GRAMMAR_ANALYSIS_SCHEMA = {
```

- [ ] **Step 2: Add `export` to `TRANSITION_SYSTEM_PROMPT` and `TRANSITION_SCHEMA`**

In `functions/src/transitions.ts` line 5, change:
```typescript
const TRANSITION_SYSTEM_PROMPT = `You are an expert
```
to:
```typescript
export const TRANSITION_SYSTEM_PROMPT = `You are an expert
```

And line 42, change:
```typescript
const TRANSITION_SCHEMA = {
```
to:
```typescript
export const TRANSITION_SCHEMA = {
```

- [ ] **Step 3: Add `export` to `PROMPT_ANALYSIS_SCHEMA`**

In `functions/src/promptAdherence.ts` line 79, change:
```typescript
const PROMPT_ANALYSIS_SCHEMA = {
```
to:
```typescript
export const PROMPT_ANALYSIS_SCHEMA = {
```

Also export `PROMPT_ADHERENCE_SYSTEM_PROMPT` at line 10:
```typescript
export const PROMPT_ADHERENCE_SYSTEM_PROMPT = `...
```

- [ ] **Step 4: Add `export` to `DUPLICATION_ANALYSIS_SCHEMA`**

In `functions/src/duplication.ts` line 69, change:
```typescript
const DUPLICATION_ANALYSIS_SCHEMA = {
```
to:
```typescript
export const DUPLICATION_ANALYSIS_SCHEMA = {
```

Also export `DUPLICATION_SYSTEM_PROMPT` at the top of the file:
```typescript
export const DUPLICATION_SYSTEM_PROMPT = `...
```

- [ ] **Step 5: Add `export` to `COACH_SYNTHESIS_SCHEMA` and `COACH_SYNTHESIS_SYSTEM`**

In `functions/src/synthesizeCoach.ts` line 6:
```typescript
export const COACH_SYNTHESIS_SYSTEM = `...
```

And line 31:
```typescript
export const COACH_SYNTHESIS_SCHEMA = {
```

- [ ] **Step 6: Verify TypeScript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: No errors. Adding `export` is purely additive.

- [ ] **Step 7: Run existing tests**

Run: `cd functions && npx vitest run`
Expected: All 126 tests pass. No behavior change.

---

### Task 2: Create megaPrompt.ts and megaAnalyze.ts

**Files:**
- Create: `functions/src/megaPrompt.ts`
- Create: `functions/src/megaAnalyze.ts`

#### megaPrompt.ts

- [ ] **Step 1: Create `functions/src/megaPrompt.ts`**

```typescript
/**
 * Combined system prompt and response schema for mega-prompt mode.
 * Imports and wraps existing prompts/schemas — no duplication.
 */
import { SYSTEM_PROMPT } from './prompt';
import { EVALUATION_SCHEMA } from './gemini';
import { GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA } from './grammar';
import { TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA } from './transitions';
import { PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA } from './promptAdherence';
import { DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA } from './duplication';
import { COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA } from './synthesizeCoach';

const V3_QUALITY_BOOST = `## CRITICAL: FEEDBACK QUALITY STANDARDS
You are being evaluated on the SPECIFICITY and ACTIONABILITY of your feedback. Follow these rules strictly:

### Specificity
- Every feedback statement must reference EXACT text from the essay. No generic praise or criticism.
- Name the specific craft move (rhetorical question, anaphora, topic sentence, etc.) or the specific error type (comma splice, dangling modifier, anachronism).
- Check for factual errors, anachronisms, incorrect attributions, and logical fallacies. Call them out.

### Actionability
- Each annotation must end with a Socratic question the student can answer in one paragraph.
- Questions must reference the student's actual words: "Your phrase 'X' — [specific question]?"
- Never ask "How could this be better?" Instead: "What specific evidence would convince a skeptic of this claim?"

### Annotation Quality
- Quote the EXACT phrase, not a whole paragraph.
- When praising: explain WHY it works so the student can replicate the technique elsewhere.
- When critiquing: identify the EXACT problem AND guide toward the fix through questioning.
- Mix positive and negative — students need to know what's working so they do MORE of it.

### Self-Check Before Responding
Before finalizing your response, verify:
- Does every feedback sentence cite specific text? If not, add the citation.
- Does every annotation comment include a specific Socratic question? If not, add one.
- Have you checked for factual/historical accuracy in the student's claims?`;

export const MEGA_SYSTEM_PROMPT = `You are an expert writing coach and analyst for high school students. You will perform a COMPLETE analysis of a student essay in a single pass, covering ALL of the following sections:

1. TRAIT EVALUATION (6+1 traits, scored 1-6)
2. GRAMMAR ANALYSIS (sentence-level mechanics and patterns)
3. TRANSITION ANALYSIS (sentence and paragraph flow)
4. PROMPT ADHERENCE ANALYSIS (coverage of assignment requirements)
5. DUPLICATION ANALYSIS (repeated ideas)
6. COACH SYNTHESIS (overall readiness and next steps)

${SYSTEM_PROMPT}

## SECTION 2: GRAMMAR ANALYSIS
${GRAMMAR_SYSTEM_PROMPT}

## SECTION 3: TRANSITION ANALYSIS
${TRANSITION_SYSTEM_PROMPT}

## SECTION 4: PROMPT ADHERENCE ANALYSIS
${PROMPT_ADHERENCE_SYSTEM_PROMPT}

## SECTION 5: DUPLICATION ANALYSIS
${DUPLICATION_SYSTEM_PROMPT}

## SECTION 6: COACH SYNTHESIS
${COACH_SYNTHESIS_SYSTEM}

${V3_QUALITY_BOOST}`;

export const MEGA_SCHEMA = {
  type: 'object' as const,
  properties: {
    evaluation: EVALUATION_SCHEMA,
    grammarAnalysis: GRAMMAR_ANALYSIS_SCHEMA,
    transitionAnalysis: TRANSITION_SCHEMA,
    promptAnalysis: PROMPT_ANALYSIS_SCHEMA,
    duplicationAnalysis: DUPLICATION_ANALYSIS_SCHEMA,
    coachSynthesis: COACH_SYNTHESIS_SCHEMA,
  },
  required: [
    'evaluation', 'grammarAnalysis', 'transitionAnalysis',
    'promptAnalysis', 'duplicationAnalysis', 'coachSynthesis',
  ] as const,
};
```

- [ ] **Step 2: Verify it compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: No errors. All imports should resolve.

If any import fails (e.g., `TRANSITION_SYSTEM_PROMPT` is named differently), check the source file and fix the import name. The system prompt constants are:
- `grammar.ts`: `GRAMMAR_SYSTEM_PROMPT` (line 9, currently not exported — was exported in step 1)
- `transitions.ts`: `TRANSITION_SYSTEM_PROMPT` (line 5, needs export added)
- `promptAdherence.ts`: `PROMPT_ADHERENCE_SYSTEM_PROMPT` (line 10)
- `duplication.ts`: `DUPLICATION_SYSTEM_PROMPT` (check exact name)
- `synthesizeCoach.ts`: `COACH_SYNTHESIS_SYSTEM` (line 6)

Check each file for the exact constant name and add `export` if not done in Task 1.

#### megaAnalyze.ts

- [ ] **Step 3: Create `functions/src/megaAnalyze.ts`**

```typescript
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
```

- [ ] **Step 4: Verify it compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Run existing tests**

Run: `cd functions && npx vitest run`
Expected: All 126 tests pass. No existing behavior changed.

---

### Task 3: Wire Mega Mode into onDraftCreated

**Files:**
- Modify: `functions/src/onDraftCreated.ts:67-82` — add early-return guard

This is the minimal production change. An early-return guard at the top of the handler, before the 5-second delay.

- [ ] **Step 1: Add mega mode guard to onDraftCreated**

In `functions/src/onDraftCreated.ts`, add imports at the top (after existing imports):

```typescript
import { megaAnalyze } from './megaAnalyze';
import { getFirestore } from 'firebase-admin/firestore';
```

Then, inside the handler function (after the `if (!snap) return;` check at line 76, before the 5-second delay at line 81), add the mega mode guard:

```typescript
    // ── Mega mode: single combined Gemini call ──────────────────────────
    const db = getFirestore();
    const megaConfig = await db.doc('config/megaPrompt').get();
    if (megaConfig.exists && megaConfig.data()?.enabled) {
      const megaModel = megaConfig.data()?.model || 'gemini-3.1-flash-lite-preview';

      try {
        // Mark mega in progress so fallback path doesn't also start
        await draftRef.update({ megaInProgress: true });

        // Set all status fields to thinking
        await draftRef.update({
          evaluationStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          grammarStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          transitionStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          promptStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          duplicationStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          coachSynthesisStatus: { stage: 'thinking', message: 'Analyzing essay...' },
        });

        // Load essay metadata
        const essayRef = draftRef.parent.parent!;
        const essaySnap = await essayRef.get();
        const essayData = essaySnap.data();
        const assignmentPrompt = essayData?.assignmentPrompt || '';
        const writingType = essayData?.writingType || 'argumentative';
        const content = snap.data()!.content;
        const draftNumber = snap.data()!.draftNumber || 1;

        // Load previous evaluation for resubmissions
        let previousEvaluation: Record<string, unknown> | null = null;
        if (draftNumber > 1) {
          const prevDrafts = await draftRef.parent
            .where('draftNumber', '==', draftNumber - 1)
            .limit(1)
            .get();
          previousEvaluation = prevDrafts.empty
            ? null
            : prevDrafts.docs[0].data().evaluation || null;
        }

        const result = await megaAnalyze({
          apiKey: geminiApiKey.value(),
          content,
          assignmentPrompt,
          writingType,
          draftNumber,
          previousEvaluation,
          model: megaModel,
          draftRef,
        });

        // Write all 6 analysis fields + clear all status fields
        await draftRef.update({
          evaluation: result.evaluation,
          grammarAnalysis: result.grammarAnalysis,
          transitionAnalysis: result.transitionAnalysis,
          promptAnalysis: result.promptAnalysis,
          duplicationAnalysis: result.duplicationAnalysis,
          coachSynthesis: result.coachSynthesis,
          evaluationStatus: null,
          grammarStatus: null,
          transitionStatus: null,
          promptStatus: null,
          duplicationStatus: null,
          coachSynthesisStatus: null,
          megaInProgress: null,
        });

        logger.info('Mega analysis complete', { uid, essayId, draftId, model: megaModel });
        return; // Done — skip the entire existing parallel path
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error('Mega analysis failed, falling back to separate calls', { error: msg, uid, essayId, draftId });

        // Retry once on SyntaxError
        if (error instanceof SyntaxError) {
          try {
            const essayRef = draftRef.parent.parent!;
            const essaySnap = await essayRef.get();
            const essayData = essaySnap.data();

            const result = await megaAnalyze({
              apiKey: geminiApiKey.value(),
              content: snap.data()!.content,
              assignmentPrompt: essayData?.assignmentPrompt || '',
              writingType: essayData?.writingType || 'argumentative',
              draftNumber: snap.data()!.draftNumber || 1,
              previousEvaluation: null,
              model: megaConfig.data()?.model || 'gemini-3.1-flash-lite-preview',
              draftRef,
            });

            await draftRef.update({
              evaluation: result.evaluation,
              grammarAnalysis: result.grammarAnalysis,
              transitionAnalysis: result.transitionAnalysis,
              promptAnalysis: result.promptAnalysis,
              duplicationAnalysis: result.duplicationAnalysis,
              coachSynthesis: result.coachSynthesis,
              evaluationStatus: null, grammarStatus: null, transitionStatus: null,
              promptStatus: null, duplicationStatus: null, coachSynthesisStatus: null,
              megaInProgress: null,
            });

            logger.info('Mega analysis retry succeeded', { uid, essayId, draftId });
            return;
          } catch (retryError: unknown) {
            logger.error('Mega analysis retry also failed', { error: retryError instanceof Error ? retryError.message : String(retryError) });
          }
        }

        // Clear mega lock so fallback path can proceed
        await draftRef.update({
          megaInProgress: null,
          evaluationStatus: null, grammarStatus: null, transitionStatus: null,
          promptStatus: null, duplicationStatus: null, coachSynthesisStatus: null,
        });
        // Fall through to existing parallel dispatch below
      }
    }
    // ── End mega mode guard ─────────────────────────────────────────────

```

- [ ] **Step 2: Also add mega check to the existing `runIfNeeded` guard**

In the existing `runIfNeeded` function at line 41, add a check for `megaInProgress`:

Change:
```typescript
  if (!isActivelyProcessing(data[statusField]) && !data[dataField]) {
```
to:
```typescript
  if (!data.megaInProgress && !isActivelyProcessing(data[statusField]) && !data[dataField]) {
```

This ensures that if the mega path is running, the individual handlers (called from `submitEssay` client-side dispatches) won't start duplicate work.

- [ ] **Step 3: Verify TypeScript compiles**

Run: `cd functions && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 4: Run all tests**

Run: `cd functions && npx vitest run`
Expected: All 126 tests pass. The mega path is behind a feature flag that defaults to off (the Firestore doc doesn't exist yet), so no existing behavior changes.

---

### Task 4: Create Feature Flag in Firestore

This is a manual/script step — not code.

- [ ] **Step 1: Create the feature flag (disabled)**

Run this from the project root:

```bash
cd functions && node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'essay-grader-83737x' });
const db = admin.firestore();
db.doc('config/megaPrompt').set({
  enabled: false,
  model: 'gemini-3.1-flash-lite-preview',
}).then(() => { console.log('Feature flag created (disabled)'); process.exit(0); });
"
```

Expected: `Feature flag created (disabled)`

- [ ] **Step 2: Verify it exists**

```bash
cd functions && node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'essay-grader-83737x' });
const db = admin.firestore();
db.doc('config/megaPrompt').get().then(d => { console.log(d.data()); process.exit(0); });
"
```

Expected: `{ enabled: false, model: 'gemini-3.1-flash-lite-preview' }`

---

### Task 5: Smoke Test

- [ ] **Step 1: Deploy functions**

Run: `cd functions && ./scripts/smart-deploy.sh`

- [ ] **Step 2: Test with flag disabled**

Submit an essay through the app. Verify it works exactly as before — all 6 analyses populate, coach synthesis appears. This confirms the mega guard doesn't break the existing path.

- [ ] **Step 3: Enable the flag**

```bash
cd functions && node -e "
const admin = require('firebase-admin');
admin.initializeApp({ projectId: 'essay-grader-83737x' });
admin.firestore().doc('config/megaPrompt').update({ enabled: true });
console.log('Mega mode enabled');
"
```

- [ ] **Step 4: Test with flag enabled**

Submit a new essay. Verify:
- All 6 analysis fields populate in Firestore
- The evaluation scores look reasonable
- Grammar errors are identified
- Transition analysis has sentence and paragraph transitions
- Prompt adherence has a matrix
- Duplication analysis has findings
- Coach synthesis has readiness, coachNote, recommendedReport, reportSummaries

- [ ] **Step 5: Test fallback**

Disable the flag, submit another essay. Verify the separate-call path still works.

- [ ] **Step 6: Run eval framework comparison**

```bash
cd eval
npx tsx export-firestore.ts
GEMINI_API_KEY=xxx npx promptfoo eval -o promptfoo-output.json --no-cache
ANTHROPIC_API_KEY=xxx npm run judge
```

Compare mega-mode evaluations against the existing production evaluations.
