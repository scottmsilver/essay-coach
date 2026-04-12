# Teacher Criteria Analysis

Optional per-essay teacher criteria that students can paste or import from Google Docs, edit later, and run as a standalone analysis showing how their essay meets each criterion.

## Data Model

### Essay document — new fields

```typescript
{
  teacherCriteria?: string | null,      // raw text of teacher's rubric/criteria
  criteriaSource?: DocSource | null,    // GDoc metadata if imported from Docs
}
```

Stored on the essay doc (not the draft) because criteria applies across all drafts, same as `assignmentPrompt`.

### Draft document — new fields

```typescript
{
  criteriaAnalysis?: CriteriaAnalysis | null,
  criteriaStatus?: EvaluationStatus | null,
  criteriaSnapshot?: string | null,        // frozen copy of teacherCriteria at analysis time
}
```

Mirrors the existing pattern (`grammarAnalysis`/`grammarStatus`, etc.).

`criteriaSnapshot` captures the exact criteria text used for this draft's analysis. This makes cross-draft comparisons meaningful even when the essay-level `teacherCriteria` is edited later. Written by `analyzeCriteria` alongside the analysis result.

### CriteriaAnalysis type

```typescript
interface CriterionResult {
  criterion: string;              // extracted criterion text
  status: 'met' | 'partially_met' | 'not_met';
  evidence: string;               // what in the essay supports this judgment
  comment: string;                // Socratic coaching comment
  annotations: Array<{
    quotedText: string;
    comment: string;
  }>;
}

interface CriteriaAnalysis {
  criteria: CriterionResult[];
  overallNarrative: string;       // coaching summary
  comparisonToPrevious?: {
    improvements: Array<{ criterion: string; previous: 'met' | 'partially_met' | 'not_met'; current: 'met' | 'partially_met' | 'not_met' }>;
    regressions: Array<{ criterion: string; previous: 'met' | 'partially_met' | 'not_met'; current: 'met' | 'partially_met' | 'not_met' }>;
    unchanged: Array<{ criterion: string; status: 'met' | 'partially_met' | 'not_met' }>;
    newCriteria: string[];        // criteria present now but not in previous snapshot
    removedCriteria: string[];    // criteria in previous snapshot but not current
    summary: string;              // narrative comparison
  } | null;
}
```

## Input & Editing UX

### NewEssayPage — new optional field

Position: between "Assignment Prompt" and "Title".

- `<Textarea>` labeled "Teacher Criteria (optional)"
- Placeholder: "Paste your teacher's rubric, checklist, or assignment requirements..."
- "Import from Google Docs" button in the label row using the existing `GDocImportDialog` component (with tab picker and bookmark/section picker)
- `handleRichPaste` attached for clipboard paste
- When imported from GDoc: readonly + "Imported from Google Docs" badge with Change/Clear buttons
- If left empty, no criteria analysis runs

### EssayPage — editing criteria after submission

- Pencil icon button in the CriteriaPanel header opens a modal with the same textarea + `GDocImportDialog`
- **Only the essay owner can edit criteria.** Shared viewers see criteria as read-only. Check against essay ownership, not draft editability.
- Save writes `teacherCriteria` and `criteriaSource` to the essay doc
- Save clears `criteriaAnalysis`, `criteriaStatus`, and `criteriaSnapshot` on the current draft. Navigating to the Criteria tab lazy-triggers the analysis (same pattern as other analysis views)
- When no criteria exist: empty state with "Add Criteria" button that opens the same modal. After adding criteria via this button, the analysis lazy-triggers immediately

## Cloud Function: `analyzeCriteria`

Standalone callable following `createAnalysisHandler` pattern (same as `analyzeGrammar`, `analyzeTransitions`).

### Flow

1. Auth + allowlist check (via `createAnalysisHandler`)
2. Load essay doc to get `teacherCriteria`, `assignmentPrompt`, `writingType`
3. If `criteriaSource` exists on essay doc, re-fetch latest content from GDoc (same pattern as `evaluateEssay` re-fetching `contentSource`/`promptSource`)
4. Load draft doc to get `content`
5. If `draftNumber > 1`: load previous draft's `criteriaAnalysis` and `criteriaSnapshot` for comparison
6. Call `buildCriteriaPrompt()` to assemble the prompt — includes previous snapshot text if available so Gemini can detect criteria changes
7. Call `streamGeminiJson` with `CRITERIA_SCHEMA`, streaming status to `criteriaStatus`
8. Write `{ criteriaAnalysis: result, criteriaStatus: null, criteriaSnapshot: teacherCriteria }` to draft doc — snapshot freezes the criteria text used for this analysis

### Prompt

New `CRITERIA_SYSTEM_PROMPT` in `prompt.ts`:
- Instructs Gemini to extract discrete criteria from whatever format the teacher provided (rubric, checklist, paragraph, etc.)
- Evaluate each criterion independently against the essay
- Use the same Socratic voice as the rest of EssayCoach (guiding questions, no rewriting)
- Produce annotations quoting specific passages
- On resubmission: compare to previous criteria analysis and fill `comparisonToPrevious`
- Note if criteria text changed between drafts and handle gracefully

New `buildCriteriaPrompt(input: CriteriaInput): string` in `prompt.ts`:

```typescript
interface CriteriaInput {
  teacherCriteria: string;
  assignmentPrompt: string;
  writingType: string;
  content: string;
  previousCriteriaAnalysis?: string;  // JSON-stringified, for resubmissions
  previousCriteriaSnapshot?: string;  // previous draft's frozen criteria text, for detecting changes
}
```

Assignment prompt and writing type are included as context so Gemini understands the essay's purpose, but evaluation focuses on the teacher's criteria.

New `CRITERIA_SCHEMA` in `gemini.ts` — JSON schema matching the `CriteriaAnalysis` type for structured output.

## Firing Logic

### `fireAllAnalyses`

Conditionally calls `analyzeCriteria` only if `essay.teacherCriteria` exists. Fires in parallel with the other analysis calls.

### `onDraftCreated` fallback

Same conditional check — if `teacherCriteria` exists and criteria analysis hasn't started, fire it.

### `resubmitDraft.ts`

After creating the new draft doc, also fire `analyzeCriteria` if `teacherCriteria` exists.

### `megaAnalyze`

Mega mode bypasses all standalone callable functions. When mega mode is enabled and `teacherCriteria` exists, fire `analyzeCriteria` as a separate call after mega completes. This means criteria analysis runs as an independent Gemini call even in mega mode — it is not folded into the mega prompt.

## UI: CriteriaPanel & Sidebar

### Sidebar entry

New "Criteria" entry in `CoachDrawer` nav list. **Always visible** — routes to `/essay/:essayId/criteria`. New `ViewMode` value: `'criteria'`. When no criteria exist, the panel shows the empty state with "Add Criteria" button, letting users discover and add criteria from the essay view.

### CriteriaPanel component

Wrapped in `AnalysisPanel` (loading/error/ready states).

**Three states:**

1. **No criteria on essay** — empty state: "No teacher criteria provided. Add your teacher's rubric to see how your essay measures up." + "Add Criteria" button
2. **Loading** — `criteriaStatus` is non-null, shows streaming status messages
3. **Results** — renders the analysis

**Results layout:**

- **Overall narrative** at the top — coaching summary
- **Criteria checklist** — each `CriterionResult` as a card:
  - Status badge: green (met), yellow (partially met), red (not met)
  - Criterion text
  - Evidence + coaching comment
  - Annotation count for that criterion
- **Comparison section** (resubmissions only) — improvements/regressions/unchanged with narrative summary

### Annotations

The existing annotation pipeline is trait-specific — it derives `traitKey`/`traitLabel` from 6+1 traits and uses trait-based color mapping. Criteria annotations need a generalized renderer:

- **Annotation source abstraction:** The annotation renderer needs to accept annotations from either trait evaluations or criteria results. Each annotation should carry a `source` discriminator (e.g. `{ type: 'trait', traitKey }` or `{ type: 'criterion', criterionIndex, criterionText }`).
- **Color/group key:** Criteria annotations are grouped and color-coded by parent criterion. Use the criterion's index in the analysis results as a stable key (criterion text may be long). Assign from a secondary color palette that doesn't collide with trait colors.
- **Conflict resolution:** When the same passage is annotated by multiple criteria, stack the annotations (show both comments). Don't merge or hide duplicates.
- **View-scoped rendering:** When the "Criteria" view is active, show only criteria annotations. When "Overall" is active, show only trait annotations. No cross-contamination between views.

### Edit button

Pencil icon in the panel header. Opens a modal with textarea + `GDocImportDialog` (full tab picker + bookmark/section picker). Saving writes to the essay doc and clears analysis on the current draft.

## Report Plumbing Touch Points

Adding criteria as a first-class report requires changes across the hard-coded report system. Enumerated here so nothing is missed:

- **`src/types.ts`** — Add `'criteria'` to `ReportKey` union, add `CriteriaAnalysis`/`CriterionResult` types, extend `Draft` interface with `criteriaAnalysis`/`criteriaStatus`/`criteriaSnapshot`, extend `Essay` with `teacherCriteria`/`criteriaSource`
- **`src/entities/draftEntity.ts`** — Add criteria to entity helpers: status accessor, issue count, analysis accessor
- **`src/entities/draftPresentation.ts`** — Add criteria to report labels, descriptions, status message mapping
- **`src/hooks/useAnalysisActions.ts`** — Add `'criteria'` to the action/ensure system so lazy-triggering works. New callable config entry pointing to `analyzeCriteria`
- **`src/pages/EssayPage.tsx`** — Add `'criteria'` to `ViewMode` union, `viewFromPath()`, route handling, and the view-rendering switch. Wire up annotation source switching.
- **`src/components/CoachDrawer.tsx`** — Add "Criteria" nav entry (always visible)
- **`src/utils/submitEssay.ts`** — Add conditional `analyzeCriteria` call to `fireAllAnalyses`
- **`functions/src/index.ts`** — Export new `analyzeCriteria` callable
- **`functions/src/onDraftCreated.ts`** — Add criteria firing in both standalone and mega-mode paths
- **`functions/src/resubmitDraft.ts`** — Add criteria firing after new draft creation

## Resubmission Behavior

1. New draft created → `onDraftCreated` fires → checks `essay.teacherCriteria` → calls `analyzeCriteria`
2. `analyzeCriteria` detects `draftNumber > 1` → loads previous draft's `criteriaAnalysis` AND `criteriaSnapshot`
3. `buildCriteriaPrompt` includes both previous analysis and previous snapshot text → Gemini can detect if criteria changed and fills `comparisonToPrevious` (including `newCriteria`/`removedCriteria` if the snapshot differs)
4. Current `teacherCriteria` is frozen as `criteriaSnapshot` on the new draft
5. UI shows comparison section automatically

Because each draft stores its own `criteriaSnapshot`, comparisons are always between the criteria text that was actually used for each draft's analysis — not the current mutable essay-level criteria.

If criteria is added after first submission and analysis is triggered on draft 1, then draft 2's comparison works normally against draft 1's `criteriaAnalysis` and `criteriaSnapshot`.

## Scope Boundaries

**In scope:**
- Per-essay teacher criteria field (paste + GDoc import with tab/section picker)
- Editable from EssayPage after submission
- Standalone `analyzeCriteria` Cloud Function
- CriteriaPanel UI with checklist + narrative + annotations
- Resubmission comparison

**Out of scope:**
- Reusable assignment/criteria templates
- Teacher dashboard or classroom workflow
- Folding criteria into the mega-prompt (criteria runs as a separate call even in mega mode)
- Criteria affecting 6+1 Traits scores
- Criteria size limits (follows same policy as assignment prompts — no limit)
