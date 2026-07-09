# Multi-Judge Eval System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `eval/` into a cross-lab multi-judge panel (Claude + OpenAI + Gemini) that scores grammar / transitions / overall feedback both dimensionally and pairwise, with A/B order-swap, human-anchored Cohen's κ, and an ERRANT-style grammar-calibration track — serving as both a ship gate and an iteration objective.

**Architecture:** New pure-logic units under `eval/panel/` (types, rubrics, aggregator, metrics, F0.5) tested in isolation with vitest; thin lab adapters behind one `Judge` interface; a panel runner that fans out to 3 judges and swaps pairwise order; CLI gate/loop entrypoints; a repurposed Prompt Tuner page for the human picker.

**Tech Stack:** TypeScript (ESM, strict), tsx, vitest, `@anthropic-ai/sdk`, `openai`, `@google/genai`. React (existing) for the picker UI.

## Global Constraints

- `eval/` is **ESM** (`"type": "module"`), `strict: true`, run via `tsx`. Test with `vitest`.
- **No hard-coded model IDs or server URLs.** Model IDs come from config/env with documented defaults: anchor `claude-opus-4-8`; OpenAI + Gemini IDs via env (`PANEL_OPENAI_MODEL`, `PANEL_GEMINI_MODEL`) because their exact frontier IDs are set by the operator.
- Anthropic judges use `claude-opus-4-8` with **no `temperature`** (rejected, 400). Determinism = low `effort` + rerun-consistency, not temperature 0.
- Grammar aggregation weights the **correctness / false-positive axis ≈2× the coverage axis** (mirrors ERRANT F0.5).
- Every pairwise runs in **both A/B orders**; flag position bias when `|P(A wins) − 0.5| > 0.10`.
- Judge trust is **Cohen's κ vs. human gold labels**, never raw agreement %.
- **No commits** without the owner's explicit go-ahead + password. Adding the `openai` dep triggers the two-track security audit (CVE + codex) before merge.
- Reuse existing gate thresholds from `run-judge.ts`: feedback delta ≤ 0.5, pairwise challenger win/tie ≥ 40%, reliability ≥ 80%.

---

### Task 0: Scaffold `eval/panel/` + vitest

**Files:**
- Modify: `eval/package.json`
- Create: `eval/vitest.config.ts`
- Create: `eval/panel/README.md`
- Test: `eval/panel/smoke.test.ts`

**Interfaces:**
- Produces: a runnable `npm test` in `eval/`.

- [ ] **Step 1: Write the failing smoke test**

```ts
// eval/panel/smoke.test.ts
import { describe, it, expect } from 'vitest';
describe('panel scaffold', () => {
  it('runs', () => { expect(1 + 1).toBe(2); });
});
```

- [ ] **Step 2: Run it — expect failure (no vitest)**

Run: `cd eval && npx vitest run panel/smoke.test.ts`
Expected: FAIL — `vitest: command not found` / not installed.

- [ ] **Step 3: Add vitest and a config**

Add to `eval/package.json` devDependencies: `"vitest": "^2.1.0"`, and script `"test": "vitest run"`. Then:

```ts
// eval/vitest.config.ts
import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { include: ['panel/**/*.test.ts'] } });
```

Run `cd eval && npm install`.

- [ ] **Step 4: Run test — expect pass**

Run: `cd eval && npm test`
Expected: PASS, 1 test.

- [ ] **Step 5: Commit** (only on owner go-ahead)

```bash
git add eval/package.json eval/package-lock.json eval/vitest.config.ts eval/panel/
git commit -m "chore(eval): scaffold panel dir + vitest"
```

---

### Task 1: Core types + `Judge` interface

**Files:**
- Create: `eval/panel/types.ts`
- Test: `eval/panel/types.test.ts`

**Interfaces:**
- Produces:
  - `type ReportKind = 'overall' | 'grammar' | 'transitions'`
  - `interface DimScore { score: number; rationale: string }`
  - `interface DimensionalJudgment { dimensions: Record<string, DimScore> }`
  - `type PairwiseWinner = 'A' | 'B' | 'tie'`
  - `interface PairwiseJudgment { winner: PairwiseWinner; rationale: string }`
  - `interface Judge { id: string; lab: 'anthropic' | 'openai' | 'google'; judgeDimensional(prompt: string): Promise<DimensionalJudgment>; judgePairwise(prompt: string): Promise<PairwiseJudgment>; }`
  - `function isDimScore(x: unknown): x is DimScore`

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/types.test.ts
import { describe, it, expect } from 'vitest';
import { isDimScore } from './types';
describe('isDimScore', () => {
  it('accepts a valid dim score', () => {
    expect(isDimScore({ score: 4, rationale: 'x' })).toBe(true);
  });
  it('rejects out-of-range or malformed', () => {
    expect(isDimScore({ score: 9, rationale: 'x' })).toBe(false);
    expect(isDimScore({ score: 3 })).toBe(false);
    expect(isDimScore(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run — expect fail** (`Cannot find module './types'`)

Run: `cd eval && npx vitest run panel/types.test.ts`

- [ ] **Step 3: Implement `types.ts`**

```ts
// eval/panel/types.ts
export type ReportKind = 'overall' | 'grammar' | 'transitions';

export interface DimScore { score: number; rationale: string }
export interface DimensionalJudgment { dimensions: Record<string, DimScore> }

export type PairwiseWinner = 'A' | 'B' | 'tie';
export interface PairwiseJudgment { winner: PairwiseWinner; rationale: string }

export interface Judge {
  id: string;
  lab: 'anthropic' | 'openai' | 'google';
  judgeDimensional(prompt: string): Promise<DimensionalJudgment>;
  judgePairwise(prompt: string): Promise<PairwiseJudgment>;
}

export function isDimScore(x: unknown): x is DimScore {
  if (typeof x !== 'object' || x === null) return false;
  const o = x as Record<string, unknown>;
  return typeof o.score === 'number' && o.score >= 1 && o.score <= 5 && typeof o.rationale === 'string';
}
```

- [ ] **Step 4: Run — expect pass**

Run: `cd eval && npx vitest run panel/types.test.ts`

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): panel core types + Judge interface"`

---

### Task 2: Report rubrics (overall reuse, grammar, transitions)

**Files:**
- Create: `eval/panel/rubrics.ts`
- Test: `eval/panel/rubrics.test.ts`

**Interfaces:**
- Consumes: `ReportKind` from `./types`.
- Produces:
  - `interface RubricSpec { report: ReportKind; dimensions: string[]; weights: Record<string, number>; }`
  - `const RUBRICS: Record<ReportKind, RubricSpec>`
  - `function buildDimensionalPrompt(report: ReportKind, essay: string, feedback: string, annotationsJson: string): string`
  - `function buildPairwisePrompt(report: ReportKind, essay: string, feedbackA: string, feedbackB: string): string`

Grammar dimensions: `correctness`, `coverage`, `falsePositiveRestraint`, `fixGuidance`; weights `{ correctness: 2, coverage: 1, falsePositiveRestraint: 2, fixGuidance: 1 }`. Overall dimensions: `specificity`, `actionability`, `socratic_tone` (all weight 1) — text lifted from `eval/judges/feedback-quality.yaml`. Transitions: `gapAccuracy`, `bridgeActionability`, `noFalseAlarm` (weights `{ gapAccuracy: 2, bridgeActionability: 1, noFalseAlarm: 2 }`).

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/rubrics.test.ts
import { describe, it, expect } from 'vitest';
import { RUBRICS, buildDimensionalPrompt, buildPairwisePrompt } from './rubrics';

describe('rubrics', () => {
  it('grammar weights false positives 2x coverage', () => {
    const g = RUBRICS.grammar;
    expect(g.weights.correctness).toBe(2);
    expect(g.weights.falsePositiveRestraint).toBe(2);
    expect(g.weights.coverage).toBe(1);
  });
  it('overall keeps the three existing dimensions', () => {
    expect(RUBRICS.overall.dimensions).toEqual(['specificity', 'actionability', 'socratic_tone']);
  });
  it('dimensional prompt embeds essay + feedback + every dimension', () => {
    const p = buildDimensionalPrompt('grammar', 'ESSAY_X', 'FB_Y', '[]');
    expect(p).toContain('ESSAY_X');
    expect(p).toContain('FB_Y');
    for (const d of RUBRICS.grammar.dimensions) expect(p.toLowerCase()).toContain(d.toLowerCase().slice(0, 6));
  });
  it('pairwise prompt labels A and B and both feedbacks', () => {
    const p = buildPairwisePrompt('transitions', 'E', 'AAA', 'BBB');
    expect(p).toContain('AAA'); expect(p).toContain('BBB');
    expect(p).toMatch(/FEEDBACK A/); expect(p).toMatch(/FEEDBACK B/);
  });
});
```

- [ ] **Step 2: Run — expect fail**

Run: `cd eval && npx vitest run panel/rubrics.test.ts`

- [ ] **Step 3: Implement `rubrics.ts`**

Define `RUBRICS` with the dimensions/weights above. `buildDimensionalPrompt` composes a per-report instruction block (grammar block emphasizes "a correct sentence flagged as wrong is worse than a missed error"; overall block reuses the specificity/actionability/socratic_tone text from `feedback-quality.yaml`; transitions block describes gap accuracy) followed by `ESSAY:\n${essay}\n\nFEEDBACK:\n${feedback}\n\nANNOTATIONS:\n${annotationsJson}` and a JSON-only response instruction listing exactly the report's dimensions. `buildPairwisePrompt` composes `ESSAY:\n${essay}\n\n--- FEEDBACK A ---\n${feedbackA}\n\n--- FEEDBACK B ---\n${feedbackB}` + a `{"winner":"A"|"B"|"tie","rationale":"..."}` instruction.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): per-report rubrics with F0.5-style grammar weighting"`

---

### Task 3: Aggregator (mean dims, majority winner, position-bias flag)

**Files:**
- Create: `eval/panel/aggregate.ts`
- Test: `eval/panel/aggregate.test.ts`

**Interfaces:**
- Consumes: `DimensionalJudgment`, `PairwiseJudgment`, `RubricSpec` (weights).
- Produces:
  - `interface ItemVerdict { weightedMean: Record<'A'|'B', number>; majorityWinner: 'A'|'B'|'tie'; positionBiasFlag: boolean; disagreement: boolean; perJudgePairwise: PairwiseWinner[]; }`
  - `function aggregateItem(input: { weights: Record<string, number>; dimA: DimensionalJudgment[]; dimB: DimensionalJudgment[]; pairwiseAB: PairwiseJudgment[]; pairwiseBA: PairwiseJudgment[]; }): ItemVerdict`

`weightedMean` per side = Σ(dim.score × weight)/Σweight, averaged over judges. `majorityWinner` = mode of the order-corrected pairwise verdicts (BA verdict is flipped back to A/B frame before counting). `positionBiasFlag` true when, across all judges, `|P(A picked in AB order and A picked in BA order disagree)|`… i.e. compute `pA = fraction of (AB says A) over all judges+orders mapped to the A-first frame`; flag if `|pA − 0.5| > 0.10` **and** the AB/BA verdicts conflict for ≥ half the judges. `disagreement` true when there is no strict majority winner.

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/aggregate.test.ts
import { describe, it, expect } from 'vitest';
import { aggregateItem } from './aggregate';

const dj = (scores: Record<string, number>) => ({
  dimensions: Object.fromEntries(Object.entries(scores).map(([k, v]) => [k, { score: v, rationale: '' }])),
});
const W = { correctness: 2, coverage: 1 };

describe('aggregateItem', () => {
  it('weights dimensions and picks the higher-scoring side', () => {
    const dimA = [dj({ correctness: 5, coverage: 1 })]; // (5*2+1)/3 = 3.67
    const dimB = [dj({ correctness: 2, coverage: 2 })]; // (2*2+2)/3 = 2.00
    const v = aggregateItem({ weights: W, dimA, dimB, pairwiseAB: [{ winner: 'A', rationale: '' }], pairwiseBA: [{ winner: 'B', rationale: '' }] });
    expect(v.weightedMean.A).toBeCloseTo(3.67, 1);
    expect(v.weightedMean.B).toBeCloseTo(2.0, 1);
  });
  it('majority winner is order-corrected: AB=A and BA=B both mean "A"', () => {
    const three = (w: 'A'|'B') => [{ winner: w, rationale: '' }];
    // AB says A, BA says B -> both point at the A-first content -> winner A
    const v = aggregateItem({ weights: W, dimA: [dj({correctness:3,coverage:3})], dimB: [dj({correctness:3,coverage:3})],
      pairwiseAB: three('A'), pairwiseBA: three('B') });
    expect(v.majorityWinner).toBe('A');
    expect(v.positionBiasFlag).toBe(false);
  });
  it('flags position bias when AB and BA both favor the first-listed slot', () => {
    // AB says A (first slot), BA says A (first slot = the B content) -> contradictory -> position bias
    const v = aggregateItem({ weights: W, dimA: [dj({correctness:3,coverage:3})], dimB: [dj({correctness:3,coverage:3})],
      pairwiseAB: [{winner:'A',rationale:''}], pairwiseBA: [{winner:'A',rationale:''}] });
    expect(v.positionBiasFlag).toBe(true);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `aggregate.ts`**

Order-correction rule: in the BA order the slots are swapped, so a BA verdict of `A` refers to the original **B** content and vice-versa. Map each BA verdict to the A-first frame (`A→B`, `B→A`, `tie→tie`) before counting. `positionBiasFlag`: after mapping, if a judge's AB verdict and its mapped BA verdict disagree, that judge showed position sensitivity; set the flag when ≥ half the judges disagree, or when the raw first-slot pick rate `|pFirst − 0.5| > 0.10` given ties excluded.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): panel aggregator with order-corrected pairwise + position-bias flag"`

---

### Task 4: Cohen's κ + gate verdict (metrics)

**Files:**
- Create: `eval/panel/metrics.ts`
- Test: `eval/panel/metrics.test.ts`

**Interfaces:**
- Produces:
  - `function cohensKappa(a: string[], b: string[]): number` — two aligned label sequences.
  - `interface GateThresholds { feedbackDeltaMax: number; challengerWinRateMin: number; reliabilityMin: number; }`
  - `const DEFAULT_GATE: GateThresholds` = `{ feedbackDeltaMax: 0.5, challengerWinRateMin: 0.4, reliabilityMin: 0.8 }`
  - `function gateVerdict(input: { feedbackDelta: number; challengerWinRate: number; reliability: number; }, t?: GateThresholds): { pass: boolean; reasons: string[] }`

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/metrics.test.ts
import { describe, it, expect } from 'vitest';
import { cohensKappa, gateVerdict, DEFAULT_GATE } from './metrics';

describe('cohensKappa', () => {
  it('is 1.0 for perfect agreement', () => {
    expect(cohensKappa(['A','B','A','tie'], ['A','B','A','tie'])).toBeCloseTo(1.0, 5);
  });
  it('is ~0 for chance agreement', () => {
    const k = cohensKappa(['A','A','B','B'], ['A','B','A','B']);
    expect(k).toBeLessThan(0.1);
  });
});
describe('gateVerdict', () => {
  it('passes when all thresholds met', () => {
    const v = gateVerdict({ feedbackDelta: 0.3, challengerWinRate: 0.5, reliability: 0.9 }, DEFAULT_GATE);
    expect(v.pass).toBe(true);
  });
  it('fails and names the failing metric', () => {
    const v = gateVerdict({ feedbackDelta: 0.7, challengerWinRate: 0.5, reliability: 0.9 });
    expect(v.pass).toBe(false);
    expect(v.reasons.join(' ')).toMatch(/delta/i);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `metrics.ts`**

`cohensKappa`: build the label set, observed agreement `po`, expected `pe = Σ (countA(l)/n)(countB(l)/n)`, return `(po − pe) / (1 − pe)` (return `1` when `pe === 1`). `gateVerdict`: check each threshold, collect reasons for failures.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): Cohen's kappa + gate verdict"`

---

### Task 5: Grammar F0.5 calibration scorer

**Files:**
- Create: `eval/panel/errant.ts`
- Test: `eval/panel/errant.test.ts`

**Interfaces:**
- Produces:
  - `interface Edit { start: number; end: number; replacement: string }`
  - `function fBeta(precision: number, recall: number, beta: number): number`
  - `function scoreEdits(system: Edit[], gold: Edit[]): { precision: number; recall: number; f05: number }` — span+replacement exact match (a simplified ERRANT for v1; note in README that full ERRANT alignment is out of scope for v1).

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/errant.test.ts
import { describe, it, expect } from 'vitest';
import { fBeta, scoreEdits } from './errant';

describe('fBeta', () => {
  it('weights precision 2x recall at beta=0.5', () => {
    // high precision, low recall should beat low precision, high recall
    const a = fBeta(1.0, 0.5, 0.5);
    const b = fBeta(0.5, 1.0, 0.5);
    expect(a).toBeGreaterThan(b);
  });
});
describe('scoreEdits', () => {
  it('rewards exact matches, punishes false positives via precision', () => {
    const gold = [{ start: 0, end: 3, replacement: 'The' }];
    const sys = [{ start: 0, end: 3, replacement: 'The' }, { start: 5, end: 8, replacement: 'zzz' }];
    const r = scoreEdits(sys, gold);
    expect(r.recall).toBeCloseTo(1.0, 5);
    expect(r.precision).toBeCloseTo(0.5, 5); // one of two edits is a false positive
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `errant.ts`**

`fBeta(p, r, b) = (1+b²)·p·r / (b²·p + r)` (return 0 when denominator 0). `scoreEdits`: true positives = edits matching on `start,end,replacement`; `precision = tp/|system|`, `recall = tp/|gold|`, `f05 = fBeta(p, r, 0.5)`.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): F0.5 grammar-calibration scorer"`

---

### Task 6: Lab adapters behind the `Judge` interface

**Files:**
- Create: `eval/panel/judges/anthropic.ts`
- Create: `eval/panel/judges/openai.ts`
- Create: `eval/panel/judges/google.ts`
- Create: `eval/panel/judges/index.ts`
- Test: `eval/panel/judges/parse.test.ts`
- Modify: `eval/package.json` (add `openai`)

**Interfaces:**
- Consumes: `Judge`, `DimensionalJudgment`, `PairwiseJudgment`.
- Produces:
  - `function parseDimensional(raw: string, dims: string[]): DimensionalJudgment` (shared JSON extraction — the `/\{[\s\S]*\}/` approach from `run-judge.ts`).
  - `function parsePairwise(raw: string): PairwiseJudgment`
  - `function makeAnthropicJudge(opts): Judge`, `makeOpenAIJudge(opts)`, `makeGoogleJudge(opts)` — each takes an injected client (for testability) + model id + `dims`.
  - `function buildPanel(env = process.env): Judge[]` — reads model ids from env (`claude-opus-4-8` default anchor; `PANEL_OPENAI_MODEL`, `PANEL_GEMINI_MODEL` required for those seats).

The parse functions are the only unit-tested part; network calls are covered by the integration task with mock clients.

- [ ] **Step 1: Write the failing parse test**

```ts
// eval/panel/judges/parse.test.ts
import { describe, it, expect } from 'vitest';
import { parseDimensional, parsePairwise } from './index';

describe('parseDimensional', () => {
  it('extracts a JSON object embedded in prose', () => {
    const raw = 'Here you go: {"correctness":{"score":4,"rationale":"ok"},"coverage":{"score":3,"rationale":"meh"}} done';
    const j = parseDimensional(raw, ['correctness', 'coverage']);
    expect(j.dimensions.correctness.score).toBe(4);
    expect(j.dimensions.coverage.score).toBe(3);
  });
  it('throws when a required dimension is missing', () => {
    expect(() => parseDimensional('{"correctness":{"score":4,"rationale":"x"}}', ['correctness','coverage'])).toThrow();
  });
});
describe('parsePairwise', () => {
  it('reads winner + rationale', () => {
    expect(parsePairwise('{"winner":"B","rationale":"clearer"}').winner).toBe('B');
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement parse helpers + adapters**

`index.ts` exports the parse helpers and `buildPanel`. Each `make*Judge` wraps its SDK call: Anthropic `client.messages.create({ model, max_tokens: 600, messages })` with **no temperature** and `output_config: { effort: 'low' }`; OpenAI `client.chat.completions.create` / responses API; Google `@google/genai` `generateContent`. All funnel raw text through `parseDimensional` / `parsePairwise`. Add `"openai": "^4.0.0"` to `eval/package.json`; run `npm install`.

- [ ] **Step 4: Run — expect pass** (`cd eval && npx vitest run panel/judges/parse.test.ts`)

- [ ] **Step 5: Security audit note + commit**

Adding `openai` triggers the two-track audit. Run `cd eval && npm audit --production` and a codex read-only review of the three adapter files before merge. Commit (on go-ahead): `git commit -m "feat(eval): lab adapters (anthropic/openai/google) behind Judge interface"`

---

### Task 7: Panel runner (fan-out + order swap)

**Files:**
- Create: `eval/panel/run-panel.ts`
- Test: `eval/panel/run-panel.test.ts`

**Interfaces:**
- Consumes: `Judge`, `RubricSpec`, `aggregateItem`, `buildDimensionalPrompt`, `buildPairwisePrompt`.
- Produces:
  - `async function runItem(input: { report: ReportKind; judges: Judge[]; essay: string; feedbackA: string; annotationsA: string; feedbackB: string; annotationsB: string; }): Promise<ItemVerdict>`

For each judge: `judgeDimensional` on A and on B; `judgePairwise` twice — once `(A,B)`, once `(B,A)`. Collect and pass to `aggregateItem`.

- [ ] **Step 1: Write the failing test with mock judges**

```ts
// eval/panel/run-panel.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runItem } from './run-panel';
import type { Judge } from './types';

function mockJudge(id: string): Judge {
  return {
    id, lab: 'anthropic',
    judgeDimensional: vi.fn(async () => ({ dimensions: { correctness: { score: 4, rationale: '' }, coverage: { score: 3, rationale: '' }, falsePositiveRestraint: { score: 4, rationale: '' }, fixGuidance: { score: 3, rationale: '' } } })),
    judgePairwise: vi.fn(async () => ({ winner: 'A' as const, rationale: '' })),
  };
}

describe('runItem', () => {
  it('calls each judge twice dimensionally and twice pairwise (AB+BA)', async () => {
    const j = mockJudge('m');
    await runItem({ report: 'grammar', judges: [j], essay: 'E', feedbackA: 'A', annotationsA: '[]', feedbackB: 'B', annotationsB: '[]' });
    expect(j.judgeDimensional).toHaveBeenCalledTimes(2);
    expect(j.judgePairwise).toHaveBeenCalledTimes(2);
  });
  it('returns an aggregated verdict', async () => {
    const v = await runItem({ report: 'grammar', judges: [mockJudge('a'), mockJudge('b'), mockJudge('c')], essay: 'E', feedbackA: 'A', annotationsA: '[]', feedbackB: 'B', annotationsB: '[]' });
    expect(v).toHaveProperty('majorityWinner');
    expect(v).toHaveProperty('positionBiasFlag');
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `run-panel.ts`** — build prompts via `rubrics`, fan out with `Promise.all`, feed `aggregateItem` using `RUBRICS[report].weights`.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): panel runner with A/B order swap"`

---

### Task 8: Human-picker trigger logic + gold-label store

**Files:**
- Create: `eval/panel/picker-store.ts`
- Test: `eval/panel/picker-store.test.ts`

**Interfaces:**
- Consumes: `ItemVerdict`, `PairwiseWinner`.
- Produces:
  - `function shouldRoute(v: ItemVerdict, opts: { sampleRate: number; isNewVariant: boolean; rand: () => number }): boolean` — true if `v.disagreement || v.positionBiasFlag || opts.isNewVariant || opts.rand() < opts.sampleRate`.
  - `interface GoldLabel { itemId: string; winner: PairwiseWinner; note?: string; ts: string }`
  - `function appendGold(path: string, label: GoldLabel): void` / `function readGold(path: string): GoldLabel[]` (JSON-array file, created if absent).

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/picker-store.test.ts
import { describe, it, expect } from 'vitest';
import { tmpdir } from 'os';
import { join } from 'path';
import { shouldRoute, appendGold, readGold } from './picker-store';

const verdict = (over: Partial<any> = {}) => ({ weightedMean: { A: 3, B: 3 }, majorityWinner: 'tie', positionBiasFlag: false, disagreement: false, perJudgePairwise: [], ...over });

describe('shouldRoute', () => {
  it('routes on disagreement regardless of sample', () => {
    expect(shouldRoute(verdict({ disagreement: true }), { sampleRate: 0, isNewVariant: false, rand: () => 1 })).toBe(true);
  });
  it('routes on the random sample', () => {
    expect(shouldRoute(verdict(), { sampleRate: 0.1, isNewVariant: false, rand: () => 0.05 })).toBe(true);
    expect(shouldRoute(verdict(), { sampleRate: 0.1, isNewVariant: false, rand: () => 0.5 })).toBe(false);
  });
});
describe('gold store', () => {
  it('round-trips labels', () => {
    const p = join(tmpdir(), `gold-${Math.floor(Math.random()*1e9)}.json`);
    appendGold(p, { itemId: 'i1', winner: 'A', ts: '2026-07-09' });
    expect(readGold(p)).toHaveLength(1);
    appendGold(p, { itemId: 'i2', winner: 'tie', ts: '2026-07-09' });
    expect(readGold(p).map(l => l.itemId)).toEqual(['i1', 'i2']);
  });
});
```

> Note: `rand` is injected (not `Math.random()` directly) so the trigger is deterministically testable.

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `picker-store.ts`**

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): picker routing logic + gold-label store"`

---

### Task 9: Gate + loop CLI entrypoints

**Files:**
- Create: `eval/panel/panel-gate.ts`
- Create: `eval/panel/panel-loop.ts`
- Modify: `eval/package.json` (scripts `panel:gate`, `panel:loop`)
- Test: `eval/panel/panel-gate.test.ts`

**Interfaces:**
- Consumes: everything above.
- Produces:
  - `async function runGate(input: { report: ReportKind; judges: Judge[]; items: Array<{ id: string; essay: string; incumbent: {feedback:string;annotations:string}; challenger:{feedback:string;annotations:string} }>; thresholds?: GateThresholds }): Promise<{ verdict: {pass:boolean;reasons:string[]}; perItem: ItemVerdict[]; routed: string[] }>`
  - `panel-loop.ts`: `runLoop(variants[]) → ranking[]` reusing `runItem` + `aggregateItem` to rank candidate prompts/models by aggregate score.

`runGate` computes `challengerWinRate` from `perItem` majority winners (challenger = side B), `feedbackDelta` from weighted means, and reliability from a rerun sample, then calls `gateVerdict`. Items where `shouldRoute` fires are collected into `routed` for the picker.

- [ ] **Step 1: Write the failing integration test (mock judges)**

```ts
// eval/panel/panel-gate.test.ts
import { describe, it, expect, vi } from 'vitest';
import { runGate } from './panel-gate';
import type { Judge } from './types';

const judge = (winner: 'A'|'B'): Judge => ({
  id: winner, lab: 'anthropic',
  judgeDimensional: vi.fn(async () => ({ dimensions: { correctness:{score:4,rationale:''}, coverage:{score:4,rationale:''}, falsePositiveRestraint:{score:4,rationale:''}, fixGuidance:{score:4,rationale:''} } })),
  judgePairwise: vi.fn(async () => ({ winner, rationale: '' })),
});

describe('runGate', () => {
  it('produces a pass/fail verdict and per-item results', async () => {
    const items = [{ id: 'i1', essay: 'E', incumbent: { feedback: 'inc', annotations: '[]' }, challenger: { feedback: 'chal', annotations: '[]' } }];
    const out = await runGate({ report: 'grammar', judges: [judge('A'), judge('A'), judge('B')], items });
    expect(out.verdict).toHaveProperty('pass');
    expect(out.perItem).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement `panel-gate.ts` + `panel-loop.ts`**; add `"panel:gate": "tsx panel/panel-gate.ts"`, `"panel:loop": "tsx panel/panel-loop.ts"` scripts (each with a `main()` reading a fixtures file when run directly).

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): gate + loop entrypoints"`

---

### Task 10: Human-picker UI (repurpose Prompt Tuner)

**Files:**
- Modify: `src/pages/PromptTunerPage.tsx` (already untracked/in-progress)
- Create: `src/pages/JudgePickerPage.tsx` (or a mode within PromptTunerPage)
- Test: manual visual verification (no React test harness exists in `src/`)

**Interfaces:**
- Consumes: a routed-items JSON (essay + anonymized A/B feedback) produced by `runGate`.
- Produces: writes `GoldLabel`s (via a small endpoint or a downloaded JSON the eval harness reads with `readGold`).

- [ ] **Step 1: Render essay + two anonymized feedback panels** with A/B order randomized per item (store the true mapping so the recorded winner maps back to incumbent/challenger).

- [ ] **Step 2: Wire click → record `GoldLabel`** (`winner: 'A'|'B'|'tie'`, optional one-line note), advance to the next routed item.

- [ ] **Step 3: Manual verification**

Run the app, load a routed-items fixture, confirm: order is randomized, a pick records the correct underlying side, "tie" works, and the label file the eval harness reads (`readGold`) contains the verdicts.

- [ ] **Step 4: Commit** (on go-ahead): `git commit -m "feat(web): judge picker UI for human-anchored gold labels"`

---

### Task 11: Grammar-calibration track wiring

**Files:**
- Create: `eval/panel/grammar-calibration.ts`
- Create: `eval/panel/data/README.md` (how to drop BEA-2019 / JFLEG samples)
- Test: `eval/panel/grammar-calibration.test.ts`

**Interfaces:**
- Consumes: `scoreEdits`, `buildPanel`, the Gemini generator.
- Produces:
  - `function scoreModelAgainstGold(modelEdits: Record<string, Edit[]>, gold: Record<string, Edit[]>): { precision: number; recall: number; f05: number }` — micro-averaged over sentences.

- [ ] **Step 1: Write the failing test**

```ts
// eval/panel/grammar-calibration.test.ts
import { describe, it, expect } from 'vitest';
import { scoreModelAgainstGold } from './grammar-calibration';

describe('scoreModelAgainstGold', () => {
  it('micro-averages precision/recall across sentences', () => {
    const gold = { s1: [{ start: 0, end: 3, replacement: 'The' }], s2: [{ start: 0, end: 1, replacement: 'A' }] };
    const model = { s1: [{ start: 0, end: 3, replacement: 'The' }], s2: [] };
    const r = scoreModelAgainstGold(model, gold);
    expect(r.recall).toBeCloseTo(0.5, 5); // 1 of 2 gold edits found
    expect(r.precision).toBeCloseTo(1.0, 5);
  });
});
```

- [ ] **Step 2: Run — expect fail**

- [ ] **Step 3: Implement** — pool tp/system/gold counts across sentences, then `fBeta(p, r, 0.5)`. A `main()` loads `data/*.json`, runs each panel model + the generator, prints an F0.5 leaderboard, and writes `grammar-leaderboard.json`.

- [ ] **Step 4: Run — expect pass**

- [ ] **Step 5: Commit** (on go-ahead): `git commit -m "feat(eval): grammar-calibration F0.5 leaderboard track"`

---

## Self-Review

**Spec coverage:** panel (T6) · both primitives (T2 rubrics, T7 runner) · aggregator + order-swap + position bias (T3) · κ + gate (T4) · grammar rubric 2× weighting (T2) · grammar-calibration/F0.5 (T5, T11) · human picker trigger+store+UI (T8, T10) · gate + loop modes (T9). All spec sections map to a task.

**Placeholder scan:** no TODO/TBD; every code step shows real code; model IDs are config-driven by design (not placeholders).

**Type consistency:** `Judge`, `DimScore`, `DimensionalJudgment`, `PairwiseJudgment`, `PairwiseWinner`, `ItemVerdict`, `RubricSpec`, `GateThresholds`, `Edit`, `GoldLabel` are defined once (T1/T2/T3/T4/T5/T8) and consumed by name downstream. `aggregateItem` weights come from `RUBRICS[report].weights`; `runItem` returns `ItemVerdict`; `runGate` consumes it.

## Execution Handoff

Two options: **Subagent-Driven** (fresh subagent per task, review between) or **Inline** (batch with checkpoints). Recommend subagent-driven given the number of isolated pure-logic units.
