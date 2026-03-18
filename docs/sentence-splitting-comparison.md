# Sentence Splitting: Compromise NLP vs Gemma3 4B (Ollama)

**Date:** 2026-03-15
**Environment:** Node v24.12, Ollama with gemma3:4b (3.3 GB), compromise v14

## Purpose

Compare the `compromise` NLP library (rule-based) with `gemma3:4b` via local Ollama inference for sentence boundary detection on challenging text inputs typical of student essays.

## Test Corpus

| # | Category | Input |
|---|----------|-------|
| 1 | Smart quotes | `He said "hello." She waved.` |
| 2 | Abbreviations | `Mr. Smith went to Washington. He met Dr. Jones at 3 p.m. They discussed U.S. policy.` |
| 3 | Decimals | `The price is 3.14 dollars. That seems fair.` |
| 4 | Ellipsis | `Wait... really? Yes! Absolutely.` |
| 5 | Period in parens | `He explained it (see p. 42). She agreed.` |
| 6 | Essay text (smart quotes + possessives) | `Conkling effectively removed the executive's constitutional right...` |
| 7 | Complex (abbrevs + quotes + numbers) | `In Jan. 2024, Dr. Martin Luther King Jr. Day fell on a Monday...` |

## Correctness Results

| Test Case | Compromise | Gemma3 4B |
|-----------|:----------:|:---------:|
| 1. Smart quotes | PASS | PASS |
| 2. Abbreviations | **FAIL** | PASS |
| 3. Decimals | PASS | PASS |
| 4. Ellipsis | PASS | PASS |
| 5. Period in parens | PASS | PASS |
| 6. Essay text | PASS | PASS |
| 7. Complex | PASS | PASS |
| **Total** | **6/7** | **7/7** |

### Compromise failure detail (Test 2)

Compromise merged "He met Dr. Jones at 3 p.m." and "They discussed U.S. policy." into a single sentence. It treated `p.m.` as an abbreviation but then failed to recognize the next capital letter as a new sentence boundary. This is a known limitation of rule-based splitters with stacked abbreviations.

**Expected:**
1. `Mr. Smith went to Washington.`
2. `He met Dr. Jones at 3 p.m.`
3. `They discussed U.S. policy.`

**Got:**
1. `Mr. Smith went to Washington.`
2. `He met Dr. Jones at 3 p.m. They discussed U.S. policy.`

## Latency Results

| Test Case | Compromise (avg of 100 runs) | Gemma3 4B (single run) |
|-----------|-----------------------------:|----------------------:|
| 1. Smart quotes | 0.319 ms | 293.7 ms |
| 2. Abbreviations | 0.605 ms | 415.9 ms |
| 3. Decimals | 0.407 ms | 319.7 ms |
| 4. Ellipsis | 0.307 ms | 296.6 ms |
| 5. Period in parens | 0.314 ms | 319.5 ms |
| 6. Essay text | 1.429 ms | 592.0 ms |
| 7. Complex | 1.054 ms | 575.9 ms |
| **Average** | **0.634 ms** | **401.9 ms** |

**Gemma3 4B is ~634x slower than compromise.**

## Analysis

### Correctness

- **Gemma3 4B: 7/7 (100%)** -- Perfect on all test cases. As an LLM, it understands context and handles abbreviation-dense text naturally.
- **Compromise: 6/7 (86%)** -- Failed on the abbreviation-heavy case where `p.m.` followed by a new sentence starting with `They` was not detected as a boundary. All other cases including smart quotes, decimals, ellipses, and the actual problematic essay text passed correctly thanks to the `stripForSplitting` preprocessing in `sentenceSplitter.ts`.

### Latency

- **Compromise: sub-millisecond** (0.3-1.4 ms per call). Negligible overhead. Can process hundreds of essays per second.
- **Gemma3 4B: 294-592 ms per call.** This is with the model already loaded in memory (warm). Cold start would add seconds. For a full essay with ~20 paragraphs, total splitting time would be 6-12 seconds.

### Practicality for Real-Time Use

| Factor | Compromise | Gemma3 4B |
|--------|-----------|-----------|
| Latency | Sub-ms; no user-perceptible delay | 300-600ms per call; noticeable in aggregate |
| Infrastructure | npm package, zero config | Requires Ollama server, GPU recommended, 3.3 GB model |
| Determinism | Fully deterministic | Non-deterministic even at temp=0 (sampling artifacts) |
| Deployment | Works in Cloud Functions | Would need a sidecar service or dedicated GPU instance |
| Cost | Free | GPU compute cost for hosting |
| Reliability | Always returns same format | LLM may occasionally add commentary, numbering, or deviate from format |

## Recommendation

**Use compromise for production.** The single failure case (abbreviation `p.m.` followed by a new sentence) is a rare edge case in student essays and can be patched with a targeted regex post-processing rule if needed. The 634x speed advantage, zero infrastructure requirements, deterministic behavior, and compatibility with Firebase Cloud Functions make compromise the clear winner for this use case.

Gemma3 4B's perfect correctness is impressive but not worth the tradeoffs in latency, infrastructure complexity, and non-determinism for a sentence-splitting task that is solved well enough by rule-based methods.

### If the `p.m.` edge case matters

Add a post-processing rule to `sentenceSplitter.ts` that re-splits any sentence containing a known time abbreviation (`a.m.`/`p.m.`) followed by a capital letter:

```typescript
// After compromise splitting, check for missed boundaries after time abbreviations
const timeSplit = sent.replace(/([ap]\.m\.)\s+([A-Z])/g, '$1\n$2');
```

This would bring compromise to 7/7 correctness while keeping sub-millisecond latency.
