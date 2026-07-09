# Eval Cockpit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-gated in-app UI + Cloud Functions to run the judge panel against real essays with a challenger prompt, with live progress and an inline gold-label picker.

**Architecture:** Panel core moves to `shared/panel/` (one source for functions + eval CLI). New onCall functions `startEvalRun` / `recordGoldLabel` follow the `submitEssay` pattern (secrets, progress doc, Firestore). UI pages under `/admin/eval` subscribe to run docs; picker internals extracted from `JudgePickerPage` into a reusable component.

**Tech stack:** existing — TypeScript ESM, firebase-functions v2 onCall, firebase-admin Firestore, React + react-router, vitest per package.

## Global Constraints

- Branch: `feat/eval-cockpit` off main. No pushes; controller commits under session authorization.
- No hard-coded model IDs (judge models come from `config/evalPanel` doc), no hard-coded server URLs, no API keys outside `defineSecret`/env.
- Anthropic judge calls: never pass `temperature` (shared adapter already enforces).
- Never a 1-judge verdict: reuse shared `runItem` min-2-seats behavior; surface `failedJudges`.
- v1 run cap: **20 essays**; reject larger requests with a clear error.
- Admin enforcement lives in the FUNCTIONS (`isEmailAdmin`); client checks are cosmetic only.
- All existing tests keep passing: eval vitest (55 after move) and functions vitest.
- Gate thresholds default `DEFAULT_GATE` (0.5 / 0.4 / 0.8) from shared metrics.
- Read `DESIGN.md` before any UI work; use existing CSS custom properties; no native dialogs (Mantine modals/notifications per recent convention).

---

### Task 1: Move panel core to `shared/panel/`

**Files:**
- Move (git mv): `eval/panel/{types,rubrics,aggregate,metrics,errant,run-panel}.ts` + their `.test.ts` + `eval/panel/judges/` (all files) → `shared/panel/` (same names; judges keep their subdir).
- Modify: `eval/panel/{panel-gate,panel-loop,grammar-calibration,picker-store}.ts` — imports become `../../shared/panel/...`.
- Modify: `eval/vitest.config.ts` include → `['panel/**/*.test.ts', '../shared/panel/**/*.test.ts']`.
- Modify: `eval/tsconfig.json` — drop `rootDir` (or set to `..`) and add `"../shared/panel/**/*.ts"` to include so tsc still checks everything.
- `shared/panel/picker-store` does NOT move (fs-based, eval-only). `smoke.test.ts` stays in eval.

**Interfaces:** unchanged — only module paths move. `shared/panel/judges/index.ts` `buildPanel(env, dims, opts?)` is what functions will consume.

- [ ] Step 1: `git mv` the files; fix all import specifiers (within moved files they stay relative to each other, so mostly untouched; entrypoint files in eval/panel update to `../../shared/panel/`).
- [ ] Step 2: update vitest include + tsconfig as above.
- [ ] Step 3: `cd eval && npx vitest run` → expect all 55 tests pass (14 files, some now resolved from ../shared). `npx tsc --noEmit` → clean.
- [ ] Step 4: verify functions still build: `cd functions && npm run build` (no functions code imports panel yet — this is a no-regression check).
- [ ] Step 5: commit `refactor(panel): move panel core to shared/ for functions+eval reuse`.

---

### Task 2: Admin gate helper

**Files:**
- Create: `functions/src/admins.ts`
- Test: `functions/tests/admins.test.ts`

**Interfaces:**
- Produces: `export async function isEmailAdmin(email: string | undefined): Promise<boolean>` — reads Firestore doc `config/admins` field `emails: string[]`; false for undefined email, missing doc, or non-member. Mirror `functions/src/allowlist.ts` exactly (same db access pattern, same test style as `functions/tests/allowlist.test.ts` — read both before writing).

- [ ] Step 1: write failing test cloning allowlist.test.ts's mocking approach: member email → true; non-member → false; missing doc → false; undefined email → false.
- [ ] Step 2: run `cd functions && npx vitest run tests/admins.test.ts` → FAIL (module missing).
- [ ] Step 3: implement `admins.ts` mirroring `allowlist.ts`.
- [ ] Step 4: test passes; full `npx vitest run` no regressions.
- [ ] Step 5: commit `feat(functions): config/admins gate helper`.

---

### Task 3: Analyzer `systemPromptOverride`

**Files:**
- Modify: `functions/src/grammar.ts` (`analyzeGrammarWithGemini`), `functions/src/transitions.ts` (`analyzeTransitionsWithGemini`), `functions/src/gemini.ts` (`evaluateWithGemini` — the "overall" 6+1 path).
- Test: `functions/tests/promptOverride.test.ts`

**Interfaces:**
- Each function gains a trailing optional param `opts?: { systemPromptOverride?: string }`. When present and non-empty, it replaces the `systemInstruction` passed to Gemini; otherwise behavior is byte-identical to today. No call-site changes (all existing callers omit it).

- [ ] Step 1: failing tests — mock the Gemini call layer (see how `functions/tests/analyzeGrammar.test.ts` mocks `streamGeminiJson`) and assert: (a) without opts, `systemInstruction` === the module's own prompt const; (b) with override, `systemInstruction` === override, and the user prompt/content is unchanged.
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement the param in all three functions (transitions note: override applies to the MAIN `TRANSITION_SYSTEM_PROMPT` call only, not the recheck pass — document with a comment).
- [ ] Step 4: tests pass; full functions suite green; `npm run build` clean.
- [ ] Step 5: commit `feat(functions): optional systemPromptOverride on grammar/transitions/overall analyzers`.

---

### Task 4: `startEvalRun` orchestrator

**Files:**
- Create: `functions/src/evalRun.ts` (exports `startEvalRun` onCall + pure `runEvalCore` for tests)
- Modify: `functions/package.json` (add `openai`, current `@anthropic-ai/sdk` — same versions as eval/package.json)
- Test: `functions/tests/evalRun.test.ts`

**Interfaces:**
- `runEvalCore(deps, input)` — pure, dependency-injected core:
  ```ts
  interface EvalDeps {
    generate: (report: ReportKind, essay: string, override?: string) => Promise<{ feedback: string; annotations: string }>;
    judges: Judge[];                      // from shared/panel
    writeProgress: (p: { done: number; total: number; message: string }) => Promise<void>;
    writeItem: (itemId: string, item: EvalItemDoc) => Promise<void>;
    rand?: () => number;
  }
  interface EvalRunInput { report: ReportKind; essays: Array<{ id: string; content: string }>; challengerPromptOverride: string; thresholds?: GateThresholds; }
  // returns { verdict, failedJudges, routedCount }
  ```
  Per essay: `generate(report, essay)` (incumbent) + `generate(report, essay, override)` (challenger) → `runItem` from `shared/panel/run-panel` → `shouldRoute`-equivalent routing (inline: disagreement || positionBiasFlag || rand()<0.05) → `writeItem`. Then compute `challengerWinRate`/`feedbackDelta`/`reliability` exactly as `eval/panel/panel-gate.ts` does (read it; keep the same formulas + v1 reliability stand-in comment) → `gateVerdict`.
- `startEvalRun` onCall wrapper: pattern-match `functions/src/submitEssay.ts` (auth + `isEmailAllowed`) PLUS `isEmailAdmin` check (403 HttpsError otherwise). Options: `{ timeoutSeconds: 1800, memory: '1GiB', secrets: [geminiApiKey, openaiApiKey, anthropicApiKey] }`. Validates: report ∈ 3 kinds, 1 ≤ essayIds.length ≤ 20, non-empty override. Loads essays (same draft-content access as `createAnalysisHandler` — read it for the lookup), loads `config/evalPanel` (missing → HttpsError naming the field), builds judges via `buildPanel({ ANTHROPIC_API_KEY: ..., OPENAI_API_KEY: ..., GEMINI_API_KEY: ..., PANEL_ANTHROPIC_MODEL: cfg.anthropicModel, PANEL_OPENAI_MODEL: cfg.openaiModel, PANEL_GEMINI_MODEL: cfg.geminiModel }, RUBRICS[report].dimensions)`, creates `evalRuns/{id}` doc (status `generating`), runs `runEvalCore` with Firestore-backed deps (generate = Task 3 analyzers, feedback = `JSON.stringify(analysis, null, 2)`, annotations = `"[]"`; for `overall`, extract trait annotations into the annotations JSON), sets status `judging` → `complete`/`error`, returns `{ runId }`.

- [ ] Step 1: failing tests for `runEvalCore` with stub deps: (a) happy path 2 essays → verdict shape + writeItem called 2×, progress monotonic; (b) routing: forced disagreement verdict → routed item flagged; (c) essay cap enforced in a small validation helper `validateEvalInput` (export it; >20 essays → throws naming the cap).
- [ ] Step 2: run → FAIL.
- [ ] Step 3: implement; `npm install` the two SDK deps.
- [ ] Step 4: tests pass; full functions suite green; build clean.
- [ ] Step 5: commit `feat(functions): startEvalRun orchestrator (panel gate in-app)`.

---

### Task 5: `recordGoldLabel`, exports, rules

**Files:**
- Create: `functions/src/recordGoldLabel.ts`
- Modify: `functions/src/index.ts` (export `startEvalRun`, `recordGoldLabel`)
- Modify: `firestore.rules` (read rules for `evalRuns/**`, `evalGoldLabels/**`, `config/admins`, `config/evalPanel`)
- Test: `functions/tests/recordGoldLabel.test.ts`

**Interfaces:**
- `recordGoldLabel` onCall `{ runId, itemId, winner: 'A'|'B'|'tie', note? }`: auth + admin check; validates winner; writes `goldLabel: { winner, note?, ts: ISO, by: email }` on `evalRuns/{runId}/items/{itemId}` (item must exist → 404 HttpsError) and mirrors `{ runId, itemId, report (from run doc), winner, note?, ts, by }` to `evalGoldLabels` (auto-id).
- Rules: `evalRuns/{run=**}` and `evalGoldLabels/{id}`: `allow read: if request.auth != null && request.auth.token.email in get(/databases/$(database)/documents/config/admins).data.emails; allow write: if false;`. `config/admins`, `config/evalPanel`: read for any authed user (client nav check), write false. Match existing rules file style — read it first.

- [ ] Step 1: failing tests: valid label written + mirrored; invalid winner rejected; non-admin rejected; missing item → error.
- [ ] Step 2: FAIL → implement → PASS; full suite green.
- [ ] Step 3: index.ts exports added (the esbuild changed-functions graph picks these up automatically).
- [ ] Step 4: commit `feat(functions): recordGoldLabel + eval firestore rules + exports`.

---

### Task 6: Extract reusable compare/picker component

**Files:**
- Create: `src/components/EvalComparePicker.tsx`
- Modify: `src/pages/JudgePickerPage.tsx` (delegate to the component; file-load flow unchanged)

**Interfaces:**
- `EvalComparePicker` props: `{ essay: string; feedbackA: string; feedbackB: string; onPick: (winner: 'A'|'B'|'tie', note?: string) => void; index: number; total: number }` — owns the per-item random swap (state), blind labels, canonical remap (A=incumbent), keyboard a/b/t + Enter, note input, progress display. Everything currently inline in `JudgePickerPage`'s compare view moves here; `JudgePickerPage` keeps only file-load/validation/summary/download and renders the component per item.

- [ ] Step 1: extract; behavior-preserving (canonical remap logic identical — copy, don't rewrite).
- [ ] Step 2: `npx tsc -p tsconfig.app.json --noEmit` clean; `npx vite build` succeeds.
- [ ] Step 3: commit `refactor(web): extract EvalComparePicker from JudgePickerPage`.

---

### Task 7: Cockpit pages + routes + nav

**Files:**
- Create: `src/pages/EvalRunsPage.tsx`, `src/pages/EvalRunDetailPage.tsx`
- Create: `src/hooks/useIsAdmin.ts` (reads `config/admins` doc, compares `user.email`; false on permission error)
- Modify: `src/App.tsx` (two routes inside the ProtectedRoute layout: `/admin/eval`, `/admin/eval/:runId`)
- Modify: the app nav/Layout (find where nav links render; add "Eval" link gated by `useIsAdmin`)

**Behavior:**
- `EvalRunsPage`: lists `evalRuns` ordered by `createdAt` desc (onSnapshot); status chip (● complete PASS/FAIL, ◐ running with progress); **New Run** section: report select, essay multi-select (query the same drafts collection the app lists — read how HomePage fetches essays and reuse; cap selection at 20), challenger label + prompt textarea (prefilled: fetch current prompt const? v1 = placeholder text telling the user to paste; do NOT import server prompt consts into the client), call-count estimate (`essays × (12 judge calls + 2 generations)`), Run button → `httpsCallable('startEvalRun')` → navigate to detail.
- `EvalRunDetailPage`: onSnapshot run doc + items subcollection; progress bar + message while running; stalled banner if status ∈ {generating,judging} and no doc update for 3 min (compare snapshot metadata/progress timestamps client-side); verdict card (PASS/FAIL, three metrics vs thresholds, failedJudges warning banner); items table (essay excerpt, majority winner, means, flags, routed marker, gold label if present); routed items → `EvalComparePicker` inline, `onPick` → `httpsCallable('recordGoldLabel')` with Mantine notification on success/error.
- Follow DESIGN.md; match existing page structure conventions (read `src/pages/HomePage.tsx` first).

- [ ] Step 1: implement hook + pages + routes + nav gate.
- [ ] Step 2: `npx tsc -p tsconfig.app.json --noEmit` clean; `npx vite build` succeeds.
- [ ] Step 3: commit `feat(web): eval cockpit pages (/admin/eval) with inline picker`.

---

### Task 8: Visual verification (controller-run)

- [ ] Step 1: `npm run dev`; seed `config/admins` with the owner email in the emulator or dev project — if no emulator, verify with a mocked `useIsAdmin` return and a fixture run doc; state clearly which path was used.
- [ ] Step 2: browse-skill screenshots of: runs list (empty + populated), New Run form (with estimate), run detail (running, complete-PASS, routed-item picker open). Fix visual defects found; re-shoot.
- [ ] Step 3: commit any fixes `fix(web): eval cockpit visual polish`.

---

### Final: whole-branch review + audits + deploy prep

- [ ] Final code review (most capable model) over the branch diff; fix wave if needed.
- [ ] Track 1: `cd functions && npm audit --production` (new deps: openai, @anthropic-ai/sdk). Track 2: codex read-only over evalRun.ts, recordGoldLabel.ts, rules diff, and the two pages (auth checks, injection, data exposure).
- [ ] Write the operator checklist into the run summary for the user: `firebase functions:secrets:set OPENAI_API_KEY / ANTHROPIC_API_KEY`, create `config/admins` + `config/evalPanel` docs, deploy via smart-deploy, then a 2-essay live E2E.

## Self-Review

Spec coverage: shared move (T1) · admin gate (T2, T5 rules) · prompt override (T3) · orchestrator + progress + cap + degradation (T4) · gold labels + mirror (T5) · picker reuse (T6) · pages/routes/nav/stalled/estimate (T7) · visual (T8) · audits + operator steps (Final). No placeholders; interfaces named with exact signatures; formulas deferred only to named existing files (panel-gate.ts) per DRY.
