# Model Evaluation Framework Design

## Problem

We want to evaluate whether cheaper/faster Gemini models (starting with 3.1 Flash Light) can replace the current `gemini-3.1-pro-preview` without degrading output quality. This needs to be a reusable framework, not a one-off comparison, so future model swaps are low-effort.

## Approach

Promptfoo-based evaluation pipeline with two data tracks, Claude-as-judge for feedback quality, and an interactive side-by-side comparison UI. The eval framework calls the **same production code path** with a different model parameter, not a parallel reimplementation.

## Prerequisite: Parameterize Model in Production Code

Before building the eval framework, refactor the production Gemini call path so the model name is a parameter instead of a hardcoded constant. This is a small, safe change that eliminates the biggest source of eval/production drift.

**Changes:**
1. `functions/src/streamGemini.ts:4` — move the hardcoded `MODEL = 'gemini-3.1-pro-preview'` into `StreamOptions` as an optional field with the current value as the default
2. `functions/src/gemini.ts` — thread an optional `model` parameter through `evaluateWithGemini` into `streamGeminiJson`
3. Export `EVALUATION_SCHEMA` from `gemini.ts` so the eval framework and Promptfoo assertions can import it directly (no duplication)

The production behavior is unchanged (default model stays the same). The eval framework passes a different model name through the same function.

## Architecture & File Layout

```
eval/
├── promptfooconfig.yaml          # Main config: providers, assertions, judge
├── export-firestore.ts           # Firestore exporter (full replace by default)
├── build-calibration.ts          # Generates calibration.json from test-essays/
├── datasets/
│   ├── production.json           # Exported production evaluations (gitignored)
│   └── calibration.json          # Generated from functions/test-essays/ (gitignored)
├── providers/
│   └── gemini-essay-grader.ts    # Custom provider calling the real evaluateWithGemini
├── judges/
│   └── feedback-quality.yaml     # Claude judge prompt for feedback quality scoring
├── package.json                  # Deps: promptfoo, firebase-admin, @google/genai, @anthropic-ai/sdk
└── README.md                     # How to run evals
```

Key decisions:
- `eval/` is at project root, separate from `functions/` — this is tooling, not deployed code
- The custom provider calls the **real** `evaluateWithGemini` from `functions/src/gemini.ts` with the model parameter, using a local `GEMINI_API_KEY`. No Firebase functions, no Firestore progress tracking (progressRef omitted)
- `EVALUATION_SCHEMA` is imported from `functions/src/gemini.ts`, not duplicated
- `datasets/*.json` are gitignored; the export and build scripts are committed
- Promptfoo gives us the interactive comparison UI via `npx promptfoo view`

## Firestore Exporter

`export-firestore.ts` pulls production data from Firestore.

**Design: full replace, not incremental.** With only 88 drafts, incremental watermarking adds complexity (timestamp ties, timezone ambiguity, stale baselines from re-evaluated drafts) for zero performance benefit. Every run exports everything and overwrites `production.json`.

- **Date range flags:** `--from YYYY-MM-DD` / `--to YYYY-MM-DD` to export a specific window (all timestamps treated as UTC)
- **Default behavior:** Export all drafts that have an evaluation
- **Date field:** Uses `submittedAt` on draft documents

Each exported record contains:
- Essay content (the `content` field stored on the draft, which is the text the model actually evaluated)
- Assignment prompt (from the parent essay document)
- Writing type (from the parent essay document)
- Draft number
- Previous evaluation (for resubmission drafts where `draftNumber > 1`; null if previous draft has no evaluation or doesn't exist)
- Current model's evaluation output (the baseline to compare against)
- Document path (userId/essayId/draftId) for traceability

Current data volume: 4 users, 31 essays, 88 drafts with evaluations. Small enough to export and re-evaluate in full.

## Two Evaluation Tracks

### Track A — Production Replay (88 evaluations)

Re-runs each exported essay through the challenger model using the **same** `evaluateWithGemini` function with a different model parameter. Compares:

1. **Structural compliance** — valid JSON matching `EVALUATION_SCHEMA` with additional checks: all scores are integers 1-6, each trait has 2-4 annotations, revisionPriority is null for scores >= 4
2. **Feedback quality** — Claude judge rates feedback on specificity and actionability; annotations judged on Socratic tone (see Judge Design below)
3. **Cost/latency** — tracked per call by Promptfoo
4. **Score drift** — trait-level score comparison vs. production baseline (tracked as informational metric, not a pass/fail gate)

For resubmission drafts (those with `draftNumber > 1` and a previous evaluation in the export), the provider passes the previous evaluation so the challenger gets the same context the original model received. Drafts where the previous evaluation is missing are run as initial submissions.

### Track C — Calibration Test Suite (22 essays)

Runs calibrated test essays (ACT score 1-6, Oregon DOE exceeds/meets/approaching/does-not-meet) through both models. Checks:

1. **Average score ordering** — across all 7 traits, the average score for a score-6 essay should be higher than for a score-3. Per-trait monotonicity is not required (traits like Presentation or Conventions may not track overall essay quality)
2. **Structural compliance** — same validation as Track A
3. **Feedback quality** — same Claude judge
4. **Score reasonableness** — mapped expected ranges for average score (e.g., ACT score-5 essay should average 4-6 across traits)

Both tracks feed into the same Promptfoo UI — filterable by dataset.

(Tracks are named A and C to match the conversation where they were defined: A = all production data, C = calibration corpus. There is no Track B.)

## Acceptance Criteria

The framework must produce clear signals. These thresholds gate a model switch decision:

| Metric | Threshold | Rationale |
|--------|-----------|-----------|
| Schema pass rate | >= 95% (both tracks) | Structural failures break the UI |
| Judge feedback quality delta | <= 0.5 avg across specificity + actionability (incumbent vs challenger) | Meaningful quality regression |
| Judge annotation Socratic delta | <= 0.5 avg (incumbent vs challenger) | Annotation quality specifically |
| Pairwise preference | Challenger wins or ties >= 40% of head-to-heads | Below 40% is a clear downgrade |
| Latency | Reported per model (no hard gate, informational) | Cost/speed is the reason to switch |
| Cost | Reported per model (no hard gate, informational) | Same |
| Score drift | Reported per trait (no hard gate) | Informational only |

These thresholds are starting points. Adjust after the first run based on observed variance.

## Claude-as-Judge Design

Independent judge using `claude-sonnet-4-6`. Evaluates two aspects of output quality on separate rubrics:

### Feedback quality (applies to `feedback` and `revisionPlan` fields)

Two dimensions, each scored 1-5:

1. **Specificity** — Does the feedback reference concrete details from the essay, or is it generic? ("Your thesis is weak" = 1; "Your thesis claims X but paragraph 2 shifts to Y without connecting them" = 5)
2. **Actionability** — Can the student act on this without being told what to write? (Vague encouragement = 1; clear next step = 5)

### Annotation quality (applies to `annotations` arrays)

One dimension, scored 1-5:

3. **Socratic tone** — Do the annotations guide through questions rather than dictate? (Rewrites the student's text = 1; asks a question that leads the student to discover the issue = 5)

This scoping matches the actual rubric prompt: `prompt.ts` requires Socratic questioning specifically in annotations, while feedback tone varies by score band (collegial for 5-6, coaching for 3, supportive for 1-2). The judge should not penalize valid tone variation in feedback.

### Evaluation structure

- Runs per-trait: the judge sees the essay text, the trait name, and the model's feedback + annotations for that trait
- Scores each dimension 1-5 with a one-sentence rationale
- 7 traits x 3 dimensions = 21 scores per essay, per model
- Both models' outputs judged independently (not pairwise) so scores are comparable

### Pairwise comparison pass

After independent scoring, a second judge call does head-to-head per essay (not per trait): "Which model's feedback is more helpful for a student revising this essay?" Forced choice + rationale.

### Judge reliability

- On a 10% random sample of essays (~11 from production, ~2 from calibration), run the judge twice with identical inputs
- Report agreement rate. If agreement < 80%, the judge prompt needs refinement before trusting aggregate scores
- This adds ~130 extra judge calls (~$0.50), worth it for confidence in the signal

## Promptfoo Configuration

### Providers

Two providers in `promptfooconfig.yaml`, both using the custom provider wrapper that calls the real `evaluateWithGemini`:
- `gemini-3.1-pro-preview` (incumbent)
- `gemini-3.1-flash-light` (challenger)

The custom provider:
1. Imports `buildEvaluationPrompt` / `buildResubmissionPrompt` from `functions/src/prompt.ts`
2. Imports `evaluateWithGemini` from `functions/src/gemini.ts`
3. Calls it with the configured model name and local `GEMINI_API_KEY`
4. Omits `progressRef` (no Firestore writes during eval)

If a future model requires different settings (temperature, reasoning config), the provider config in `promptfooconfig.yaml` can pass model-specific overrides that the provider wrapper threads through to `evaluateWithGemini`.

### Assertions per test case

1. `is-json` — valid JSON response
2. `javascript` — structural validation against imported `EVALUATION_SCHEMA` plus: scores are integers 1-6, each trait has 2-4 annotations, revisionPriority null for scores >= 4
3. `llm-rubric` — Claude judge for feedback quality (specificity + actionability on feedback, Socratic tone on annotations)
4. `javascript` — score drift calculation vs. production baseline (Track A) or expected average ranges (Track C)

### Running

```bash
cd eval

# Export production data (full replace)
npx tsx export-firestore.ts

# Export with date range (UTC)
npx tsx export-firestore.ts --from 2026-01-01 --to 2026-03-31

# Build calibration dataset from test essays
npx tsx build-calibration.ts

# Run evaluation
GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npx promptfoo eval

# Open interactive comparison UI
npx promptfoo view
```

### Environment variables

- `GEMINI_API_KEY` — local API key for both Gemini models (not from Firebase secrets)
- `ANTHROPIC_API_KEY` — for Claude judge calls
- Firebase auth: uses Application Default Credentials (`gcloud auth application-default login`) for the Firestore export

### Caching

Promptfoo caches results by default. Re-running after adding a new assertion doesn't re-call Gemini. Use `--no-cache` to force fresh calls.

### Cost estimate

- 88 production + 22 calibration = 110 essays x 2 models = 220 Gemini calls
- 110 essays x 7 traits x 2 models = 1,540 Claude Sonnet judge calls (short prompts)
- 110 pairwise comparison calls
- ~130 judge reliability re-runs (10% sample)
- Total: well under $10

## Calibration Dataset Generation

`calibration.json` is generated by `build-calibration.ts` from the 22 test essays in `functions/test-essays/`. The filename convention encodes expected quality:

- ACT essays: `act-machines-score{N}.txt` — expected average score range derived from N (e.g., score5 — expect average 4-6 across traits)
- Oregon DOE essays: `oregon-{topic}-{letter}-{level}.txt` — level maps to average score ranges:
  - `exceeds` — 5-6
  - `meets` — 3-5
  - `approaching` — 2-4
  - `doesnotmeet` — 1-3
- Grade-level essays and `hayes-letter.txt`: no expected score (used for feedback quality judging only, not score reasonableness)

Output: `{ content, writingType, assignmentPrompt, expectedAvgScoreRange }` per essay. The script is committed; `calibration.json` is gitignored.

## Future Model Swaps

To evaluate a new model:
1. Add it as a provider in `promptfooconfig.yaml` (with any model-specific config overrides if needed)
2. Run `npx promptfoo eval`
3. Compare in the UI

The framework, datasets, judge prompts, and assertions are reusable. For models that need the same prompt and schema, only the provider config changes. Models that need different reasoning settings or temperature can specify overrides in the provider config block.
