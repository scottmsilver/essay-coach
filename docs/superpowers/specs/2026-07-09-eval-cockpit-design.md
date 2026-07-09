# Eval Cockpit — Design Spec

**Date:** 2026-07-09
**Status:** Approved design; implementation pending
**Companion:** [Design artifact](https://claude.ai/code/artifact/e4f0bf7e-36e8-4248-913f-ed2865ee5394) · builds on `docs/superpowers/specs/2026-07-09-multi-judge-eval-design.md` (merged to main)

## Goal

An admin-gated section of the deployed app that replaces the JSON+CLI eval workflow: pick essays, define a challenger prompt, run the judge panel server-side, watch progress live, and settle routed items in an inline picker. Gold labels land in Firestore.

## Architecture

| Piece | Responsibility |
|---|---|
| `shared/panel/` | Panel core MOVED from `eval/panel/` (types, rubrics, aggregate, metrics, errant, run-panel, judges/ incl. adapters). One tested source for functions + eval CLI. Tests move too and keep running under eval's vitest. `eval/panel/` retains only CLI entrypoints (panel-gate, panel-loop, grammar-calibration) and picker-store (fs-based), importing from `../shared/panel`. |
| `functions/src/evalRun.ts` | `startEvalRun` onCall: admin check → create `evalRuns/{id}` doc → per essay: generate incumbent + challenger feedback via REAL analyzers with `systemPromptOverride` → judge via shared panel (functions-side `buildPanel` fed by secrets + `config/evalPanel` model IDs) → write items + aggregate verdict. Progress on the run doc throughout. `timeoutSeconds: 1800`, v1 cap 20 essays/run. |
| `functions/src/recordGoldLabel.ts` | onCall: admin check → write `goldLabel` on the run item + mirror to `evalGoldLabels`. |
| `functions/src/admins.ts` | `isEmailAdmin(email)` reading `config/admins { emails: [] }` — mirrors `allowlist.ts`. |
| Analyzer override | `analyzeGrammarWithGemini` / transitions / overall accept optional `systemPromptOverride`; only the eval orchestrator passes it. Production paths unchanged. |
| `/admin/eval` UI | `EvalRunsPage` (list + New Run form) and `EvalRunDetailPage` (live progress via Firestore subscription, verdict card, per-item table, inline picker). Picker internals (blind A/B, per-item random order, canonical remap, a/b/t keys) extracted from `JudgePickerPage` into a reusable component. Nav entry visible only to admins. |

## Firestore

```
evalRuns/{runId}: report, status(generating|judging|complete|error), progress{done,total,message},
  config{essayIds[], challengerLabel, challengerPromptOverride, thresholds?},
  verdict{pass, reasons[], feedbackDelta, challengerWinRate, reliability}, failedJudges?, createdAt, createdBy
evalRuns/{runId}/items/{itemId}: essayId, essayExcerpt, incumbent{feedback,annotations},
  challenger{feedback,annotations}, verdict(ItemVerdict), routed, goldLabel?{winner,note?,ts,by}
evalGoldLabels/{labelId}: runId, itemId, report, winner, note?, ts, by
config/admins: { emails: string[] }
config/evalPanel: { anthropicModel, openaiModel, geminiModel }
```

Rules: `evalRuns/**` and `evalGoldLabels` readable only by admin emails (rules check against `config/admins`); writes only via functions (no client writes).

## Secrets & config

- New Firebase secrets `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` via `defineSecret`, declared only on the eval functions. `GEMINI_API_KEY` already exists.
- Judge model IDs in `config/evalPanel` (no deploy to change models). Missing config → fail fast naming the field (matches `buildPanel`'s never-silently-degrade rule).

## Feedback serialization for judging

Analyzer outputs are JSON (e.g. `GrammarAnalysis`). For judging, `feedback` = pretty-printed JSON string of the analysis; `annotations` = `"[]"` except `overall`, where trait annotations are extracted. Same convention as the CLI path (promptfoo output).

## Decisions

- **A.** Admin gate = `config/admins` email list; enforced in functions; client check cosmetic (nav visibility).
- **B.** v1 single-invocation runs, cap 20 essays, progress-doc pattern (as `submitEssay`). Task-queue fan-out is v2.
- **C.** Panel core to `shared/panel/`, adapters included; per-package SDK deps (`openai`, `@anthropic-ai/sdk` added to functions).
- **D.** Loop mode stays CLI-only in v1; UI ships gate + picker.

## Error handling

- Judge seat down → degrade to 2 seats via existing `failedJudges`, banner on run detail. Never 1-judge.
- Stalled run (no progress write for 3 min) → UI shows stalled state + Retry (fresh run; no partial resume in v1).
- Cost guardrail: 20-essay cap + pre-run call estimate in the New Run form.
- Prompt override never touches production analyzer behavior — it exists only within an eval run.

## Testing

- Moved panel tests stay green (55) under eval vitest; orchestrator + admins + goldLabel unit-tested with mocks under functions vitest (existing patterns).
- `vite build` + visual verification of the three screens via the browse skill.
- E2E (2-essay live run) requires the owner to set the two new secrets and `config/evalPanel` — final step, user-assisted.

## Out of scope (v1)

Loop-mode UI, task-queue fan-out, partial run resume, κ-reweighting consumption of gold labels (labels are collected, loop lands separately), automatic/scheduled runs.
