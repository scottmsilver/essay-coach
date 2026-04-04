# Mega-Prompt Consolidation Design (v2 — post Codex review)

## Problem

The app currently makes 6 separate Gemini API calls per essay submission (evaluation, grammar, transitions, prompt adherence, duplication, coach synthesis), each sending the full essay text. This costs ~6x more in input tokens than necessary and makes eval tuning slow. Experiments show a single mega-prompt call produces equivalent or better feedback quality.

## Evidence

Tested on 15 production essays with Gemini 3 Pro as judge:

| Configuration | Pro wins | Flash Lite wins | Ties | Flash win/tie % |
|---------------|----------|-----------------|------|-----------------|
| Separate calls, Flash Lite baseline | 6 | 1 | 0 | 13% FAIL |
| Mega-prompt, Flash Lite + v3-combined prompt | 7 | 7 | 1 | 53% PASS |

The v3-combined prompt adds specificity requirements, annotation quality standards, and a self-check step that closes the quality gap between Flash Lite and Pro.

## Approach

One Gemini call per essay that returns all 6 analyses in a single structured response. The response uses the **exact same schemas** each analysis uses today — no simplification, no dropping. The backend splits the response and writes to the same Firestore fields the frontend already reads. A feature flag controls mega vs separate mode.

## Architecture

The orchestration point is `onDraftCreated.ts` — the existing trigger that fans out analyses. Mega mode is an alternative path within that same orchestration point. `submitEssay` and `resubmitDraft` are unchanged.

```
Client creates draft via submitEssay / resubmitDraft
  → Firestore trigger fires onDraftCreated
  → onDraftCreated checks feature flag (Firestore config/megaPrompt.enabled)
  → Flag ON:  megaAnalyze() — 1 call, writes all 6 analysis fields
  → Flag OFF: existing parallel dispatch (evaluateEssay, analyzeGrammar, etc.)
```

### New files

- `functions/src/megaAnalyze.ts` — the mega-prompt handler
- `functions/src/megaPrompt.ts` — combined system prompt and response schema (imports and wraps existing prompts/schemas)

### Modified files

- `functions/src/onDraftCreated.ts` — minimal change: early-return guard at the top of the handler that checks the feature flag and calls `megaAnalyze()` if enabled. All existing code below the guard is untouched. Roughly 10 lines added, 0 lines modified.
- `functions/src/streamGemini.ts` — already parameterized for model name (done in eval framework work)
- 5 analysis files — add `export` keyword to their schema constants (one-word change each)

### Unchanged

- `functions/src/submitEssay.ts` — untouched
- `functions/src/resubmitDraft.ts` — untouched
- All frontend code — schemas are identical
- Firestore schema and security rules
- `shared/grammarTypes.ts` — unchanged, mega uses exact same types
- Individual analysis handlers (evaluateEssay, analyzeGrammar, etc.) — preserved for fallback
- All analysis system prompts and schemas — imported, not duplicated

## Feature Flag

Stored in `config/megaPrompt` in Firestore:

```json
{
  "enabled": true,
  "model": "gemini-3.1-flash-lite-preview"
}
```

When `enabled: false`, `onDraftCreated` runs the existing parallel dispatch. No other code path changes.

Note: this is a global toggle, not per-user. A/B testing would require additional bucketing logic (out of scope for v1). Fallback on failure is a runtime decision within the request, not a mutation of this config doc.

## Mega-Prompt Design

### System prompt

`megaPrompt.ts` imports and combines the existing system prompts:
- `SYSTEM_PROMPT` from `prompt.ts` (6+1 traits rubric)
- `GRAMMAR_SYSTEM_PROMPT` from `grammar.ts`
- `TRANSITION_SYSTEM_PROMPT` from `transitions.ts`
- `PROMPT_ADHERENCE_SYSTEM_PROMPT` from `promptAdherence.ts`
- Duplication analysis instructions (from `duplication.ts`)
- `COACH_SYNTHESIS_SYSTEM` from `synthesizeCoach.ts`
- v3-combined quality boosters (specificity, actionability, annotation quality, self-check)

The individual system prompts are NOT duplicated — they're imported from their source files. If someone updates the grammar prompt, the mega prompt picks up the change automatically.

### Response schema

Single JSON object with six top-level keys. Each key uses the **exact schema** from the corresponding analysis module:

```typescript
import { EVALUATION_SCHEMA } from './gemini';
import { GRAMMAR_ANALYSIS_SCHEMA } from './grammar';
import { TRANSITION_SCHEMA } from './transitions';
import { PROMPT_ANALYSIS_SCHEMA } from './promptAdherence';
import { DUPLICATION_SCHEMA } from './duplication';
import { COACH_SYNTHESIS_SCHEMA } from './synthesizeCoach';

const MEGA_SCHEMA = {
  type: 'object',
  properties: {
    evaluation: EVALUATION_SCHEMA,
    grammarAnalysis: GRAMMAR_ANALYSIS_SCHEMA,
    transitionAnalysis: TRANSITION_SCHEMA,
    promptAnalysis: PROMPT_ANALYSIS_SCHEMA,
    duplicationAnalysis: DUPLICATION_SCHEMA,
    coachSynthesis: COACH_SYNTHESIS_SCHEMA,
  },
  required: ['evaluation', 'grammarAnalysis', 'transitionAnalysis',
             'promptAnalysis', 'duplicationAnalysis', 'coachSynthesis'],
};
```

The schemas must be exported from their source files (some may need `export` added, same pattern as the `EVALUATION_SCHEMA` export done for the eval framework).

### Transitions: single-pass vs two-pass

The current transition analysis uses a two-pass approach: initial rating, then a contextual recheck of weak/missing transitions. The mega-prompt does a single pass. This is acceptable because:
- The mega-prompt has full essay context (all analyses at once), giving it more context than the first pass of the current approach
- The v3-combined quality instructions push for specific, grounded assessments
- The eval framework can validate transition quality hasn't regressed

If transition quality does regress, we can add a focused recheck as a second call (mega + transitions recheck = 2 calls, still better than 6).

## Request Flow (mega mode)

1. Client creates draft via `submitEssay` or `resubmitDraft` (unchanged)
2. Firestore `onCreate` trigger fires `onDraftCreated`
3. `onDraftCreated` reads `config/megaPrompt`
4. If `enabled`:
   a. Sets a mega-mode lock field on the draft (`megaInProgress: true`) to prevent the existing 5-second trigger fallback from also starting separate analyses
   b. Loads essay metadata (assignmentPrompt, writingType) from parent essay doc
   c. For resubmissions (draft 2+), loads previous draft's evaluation for comparison context
   d. Sets status fields to `{ stage: 'thinking', message: 'Analyzing essay...' }`
   e. Calls `megaAnalyze()` which:
      - Builds the combined prompt using existing prompt builders
      - Calls `streamGeminiJson` with model from config
      - Returns the parsed mega response
   f. Validates each section of the response
   g. Writes each section to its Firestore field: `evaluation`, `grammarAnalysis`, `transitionAnalysis`, `promptAnalysis`, `duplicationAnalysis`, `coachSynthesis`
   h. Clears all status fields and `megaInProgress`
5. If `enabled: false` or mega call fails: existing parallel dispatch

### Ownership protocol (preventing double-runs)

The existing `onDraftCreated` has a 5-second delay before dispatching analyses to allow `submitEssay` to write evaluation first. In mega mode:

1. `onDraftCreated` checks the feature flag BEFORE the 5-second delay
2. If mega enabled: skip the delay, immediately write `megaInProgress: true` on the draft, then start the mega call
3. The callable handlers (`submitEssay`/`resubmitDraft`) check `megaInProgress` before starting their own evaluation — if true, they skip (mega is handling everything)
4. On mega success: write all 6 analysis fields, clear `megaInProgress`
5. On mega failure: clear `megaInProgress`, then fall through to the existing 5-second-delay + parallel dispatch path

This is a simple mutex. No races because the flag is checked and set before the delay.

### Error handling

- If mega-call returns unparseable JSON: retry once (existing SyntaxError pattern)
- If retry fails or response is parseable but individual sections are malformed:
  - Write the valid sections
  - Clear `megaInProgress`
  - Dispatch individual handlers ONLY for the failed sections
  - Log the partial failure for monitoring
- If mega-call throws a non-SyntaxError (network, timeout, auth): clear `megaInProgress`, fall back to full parallel dispatch

### Progress tracking

Simplified from the original plan. The mega call updates a single status field:

1. All status fields set to `{ stage: 'thinking', message: 'Analyzing essay...' }` at start
2. When streaming transitions from thoughts to output: update to `{ stage: 'generating', message: 'Writing feedback...' }`
3. When complete: write all analysis fields and clear all status fields simultaneously

The frontend sees "Analyzing essay..." then results appear. This is slightly different from the current experience where results trickle in one at a time, but it's simpler and honest — we're not faking per-section progress for a single call.

### Google Docs re-fetch

Google Docs re-fetch logic lives in the callable `evaluateEssay` handler, NOT in the `onDraftCreated` trigger path. Since mega mode lives in the trigger path, it uses stored content — same as the trigger fallback does today. The callable handlers (`submitEssay`/`resubmitDraft`) still re-fetch from Docs before writing the draft, so by the time the trigger fires, the draft content is already current.

No change needed here.

## Model Configuration

Default mega-prompt model: `gemini-3.1-flash-lite-preview` with v3-combined quality instructions.

The model name comes from the feature flag config, not hardcoded. This lets us:
- Switch models without deploying
- Test new models by updating the config doc
- Use the eval framework to validate before switching

## Resubmission Support

For revised drafts (draft 2+):
- Load previous draft's evaluation (same lookup as `evaluateEssay.ts` lines 67-75)
- If previous evaluation exists: include it in the prompt, expect `comparisonToPrevious` in response
- If previous evaluation is missing: use the fresh evaluation prompt variant, `comparisonToPrevious` will be null
- Grammar, transitions, prompt adherence, and duplication are always fresh (no comparison to previous)
- Coach synthesis sees the evaluation's `comparisonToPrevious` and can note improvements

## Validation with Eval Framework

Before shipping, run the mega-prompt through the existing eval framework:
1. Add a mega-prompt provider to `eval/promptfooconfig.yaml` that returns the full 6-section response
2. Run against all 88 production evaluations + 22 calibration essays
3. Compare evaluation quality (the section we've been benchmarking)
4. Spot-check grammar, transition, and prompt adherence sections manually against current production outputs
5. Verify coach synthesis readiness levels match

## Cost Estimate

Current (6 separate calls with Pro):
- ~60K input tokens per essay (essay sent 6x + system prompts)
- Pro pricing

After (1 mega call with Flash Lite):
- ~14K input tokens per essay (essay sent once + combined system prompt)
- Flash Lite pricing
- ~85-90% cost reduction per essay

Output tokens increase (~3x more output per call), but output is much cheaper than input for both models.

## Rollout Plan

1. Export existing schemas from analysis modules (add `export` keyword)
2. Build `megaPrompt.ts` (imports all schemas/prompts, combines them)
3. Build `megaAnalyze.ts` (calls streamGeminiJson, splits response, validates, writes)
4. Modify `onDraftCreated.ts` (flag check, mega path, ownership protocol)
5. Deploy with flag disabled
6. Enable for internal testing, verify all 6 analysis fields populate correctly
7. Run eval framework comparison
8. Enable for all users
9. Monitor for quality regressions
