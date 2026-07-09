# Multi-Judge Eval System — Design Spec

**Date:** 2026-07-09
**Status:** Approved design; implementation pending
**Companion artifacts:** [Design doc](https://claude.ai/code/artifact/adb98fbe-7de3-451e-89d0-d1aa070a3551) · [Judge benchmark brief](https://claude.ai/code/artifact/78d8200d-9e34-4ed9-ba70-20a80f493c44) · [Grammar (GEC) brief](https://claude.ai/code/artifact/072a3015-a759-4f20-886e-a291263b012a)

## Goal

Build a cross-lab panel of high-quality LLM judges that scores EssayCoach's feedback quality, used two ways at once: a **ship/no-ship gate** for prompt/model changes, and the **objective function** for iterating prompts and models. A human (the product owner) occasionally acts as a gold-standard judge to calibrate the panel.

**Scope:** grammar, transitions, overall (the three enabled reports). Not coherence/structure/reasoning (currently flagged off).

## Background & existing code

This is an **extension**, not a rebuild. `eval/run-judge.ts` already implements:
- Dimensional scoring: `specificity` / `actionability` / `socratic_tone`, each 1–5 with rationale (`TraitJudgment`).
- Pairwise scoring: `winner: 'incumbent' | 'challenger' | 'tie'` (`PairwiseJudgment`) — but **single A/B order only** (no swap).
- A rerun-consistency check (`reliabilityCheck`, `RELIABILITY_SAMPLE_RATE = 0.1`).
- Anthropic-only judge via `callJudge()`; `JUDGE_MODEL` env-configurable.

Dependencies already present in `eval/package.json`: `@anthropic-ai/sdk`, `@google/genai`, `@azure/identity`. The judge rubric lives in `eval/judges/feedback-quality.yaml`.

## Research grounding (why the design is shaped this way)

From a July 2026 large-scale LLM-as-judge reliability study (arXiv 2606.19544) and GEC evaluations (arXiv 2605.07635, 2605.13624):

1. **Judge ↔ human agreement (Cohen's κ):** Claude Opus (κ=0.875 JudgeBench), Gemini Pro (κ=0.841), are the two strongest judge families; a top OpenAI model is the independent third.
2. **Position bias is the dominant judge bias** (magnitude up to 0.192). A/B order-swap lifts within-judge consistency ~60%→85%. Verbosity bias is now negligible (<0.011).
3. **Single-judge deployment is risky** — rankings shift up to 14 positions across benchmarks. Use a majority-of-3 panel.
4. **Raw agreement overstates κ by 34–41 points** — trust is measured in Cohen's κ, not raw %.
5. **Grammar = GEC benchmarks** (BEA-2019, CoNLL-2014, JFLEG), scored by ERRANT F0.5 which weights **precision 2× recall**. Over-correction (false positives) is the documented dominant failure mode; edit-level majority voting raises precision 19.8%→37.9%. LLM-judge + human anchor is validated for grammar (κ=0.72 among LLM judges, κ=0.975 human resolution).

## The panel

Three seats, one per lab (majority of 3):

| Seat | Model | SDK | Role |
|---|---|---|---|
| Anchor | `claude-opus-4-8` | have it | Highest judge κ; zero new deps |
| Independent | GPT-5.x | new (`openai` pkg) | Most independent from generator and anchor |
| Watched | Gemini 3 Pro | have it (`@google/genai`) | Best general judge, but generator's family — bias measured vs. human picks |

The generator under test is Gemini, so the Gemini seat carries an unmeasured self-preference risk; the human anchor measures it.

## Architecture

Six units under `eval/panel/`. Files that change together live together.

| Unit | Responsibility | Status |
|---|---|---|
| Judge adapters | One `Judge` interface (`judgeDimensional()`, `judgePairwise()`) with an impl per lab. Identical result shape. | new; wraps existing `callJudge` |
| Panel runner | Fans one item to all 3 judges; runs pairwise in **both** A/B orders. | new |
| Aggregator | Mean dimensional scores; majority winner; position-bias flag (`|P(A)−0.5|>0.10`); inter-judge disagreement. | new |
| Report rubrics | Three dimension sets — grammar, transitions, overall — one prompt template each. | extend existing |
| Human picker | Occasional pairwise UI; stores verdict as a gold label. Reuses stashed Prompt Tuner page. | repurpose |
| κ / metrics tracker | Per-judge Cohen's κ vs. gold labels; rerun-consistency; gate verdicts & variant rankings; grammar F0.5. | new |

## Judging primitives (keep both)

- **Pairwise** — "which feedback helps this student more, A or B?" Majority of 3, run in both orders, order randomized in the human picker. Drives the loop's variant ranking. Most reliable primitive.
- **Dimensional** — 1–5 rubric per report type. Gives the gate an absolute threshold and makes regressions legible without a comparison target.

## Report-specific rubrics (each dimension 1–5)

- **Overall (6+1 traits):** Specificity · Actionability · Socratic tone. *(Exists today.)*
- **Grammar:** Correctness (flagged errors real?) · Coverage (real errors missed?) · False-positive restraint · Fix-guidance quality. **Aggregation weights the correctness/false-positive axis ≈2× the coverage axis**, mirroring ERRANT F0.5.
- **Transitions:** Gap accuracy · Bridge actionability · No-false-alarm restraint.

## Grammar-calibration track (optional, folded into corpus)

Run the three judges (and the Gemini generator) against public gold-labeled GEC datasets (BEA-2019, JFLEG) and compute real ERRANT F0.5 per model. Purposes: (a) a frontier-model grammar leaderboard that doesn't exist publicly; (b) judge calibration for the grammar seat (down-weight a judge that disagrees with ERRANT gold); (c) an absolute anchor for the grammar gate. Bounded: a few hundred sentences, scored once with the ERRANT scorer. *Bonus spike (out of scope for v1): edit-level majority-voting on the generator side to reduce EssayCoach's own grammar over-correction.*

## Data flow

1. **Corpus** — production replay (sampled real drafts) + calibration essays. Each item = one essay + one report type.
2. **Generate** — baseline (incumbent) vs. candidate (challenger) via the real production code path with a model/prompt parameter.
3. **Judge** — 3 judges × dimensional + pairwise (both orders); close calls rerun 2–3×.
4. **Aggregate** — mean dims, majority winner, disagreement + position-bias flags.
5a. **Gate** — candidate must clear absolute thresholds and win ≥X% pairwise vs. incumbent.
5b. **Loop** — same panel scores rank variants (objective function).
6. **Anchor** — disagreement cases + random sample route to the human picker; verdicts recompute each judge's κ and reweight the panel.

## Human-in-the-loop picker

- **Triggers:** judge disagreement (no majority / position-bias flag), a 5% random sample, and a seed set on each new variant.
- **UI:** reuse the stashed Prompt Tuner page — essay + two anonymized feedback sets (A/B, order randomized), click better / tie, optional one-line why. Seconds per item.
- **Output:** gold labels → per-judge Cohen's κ → panel reweighting → Gemini self-preference check.

## Bias controls (load-bearing)

| Control | Why |
|---|---|
| A/B order swap, every pairwise | Position bias is dominant (≤0.192); swap lifts consistency ~60%→85%. Closes the single-order gap in `run-judge.ts`. |
| Cohen's κ, not raw agreement | Raw % overstates by 34–41 points. |
| Rerun-consistency for determinism | Opus 4.8 / Sonnet 5 reject `temperature` (400). Use low `effort` + rerun 2–3× — reuse `reliabilityCheck`. |
| Majority of 3, never 1 | Single-judge rankings shift up to 14 positions. |

## Decisions (recommended defaults, tunable)

- **A. OpenAI access:** `openai` npm package (simplest). Azure OpenAI via `@azure/identity` is the alternative if billing consolidation is preferred.
- **B. Corpus size (v1):** calibration essays + ~30–50 sampled production drafts per report; scale after the panel proves out.
- **C. Gate thresholds:** borrow the prior spec — dimensional deltas within tolerance, pairwise win-rate ≥40% vs. incumbent — tune against the first human-anchored run.
- **D. Picker cadence:** disagreement-triggered + 5% random sample.

## Cost & safety

- **Cost shape:** 3 reports × N essays × 3 judges × (dimensional + pairwise×2 orders). Bound N by sampling; run the full frontier panel at gate time, a cheaper subset in the fast loop with the full panel reserved for finalists.
- **New dependency:** the OpenAI seat adds a package (or uses Azure OpenAI). Adding it triggers the two-track security audit (CVE scan + codex review) before merge, per project protocol.
- **Secrets:** three API keys via the existing Firebase-secrets pattern. Harness runs locally/CI, never in the client. No hard-coded server URLs.

## Scope boundaries (YAGNI)

- **In:** grammar, transitions, overall.
- **Not building:** auto-promotion of a winning variant to production (gate reports, human ships); a live dashboard (start with a written report + the picker); judge fine-tuning; >3 judges / 5-judge panel (revisit only if 3-way ties are common); generator-side majority-voting (separate spike).
