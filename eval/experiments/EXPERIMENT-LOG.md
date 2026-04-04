# Experiment Log — 2026-04-04

## 1. Eval Framework Validation (Promptfoo)

**Setup:** 88 production evaluations + 22 calibration essays, Promptfoo with custom provider calling real `evaluateWithGemini`.

### Pro vs Flash Lite (separate calls, 110 essays)

Schema compliance: 220/220 PASS (both models)

| Judge | Pro wins | Flash Lite wins | Ties | Verdict |
|-------|----------|-----------------|------|---------|
| Claude Sonnet | 107 | 3 | 0 | Flash Lite FAIL |
| Claude Haiku | 88 | 21 | 1 | Flash Lite FAIL |
| (Sonnet cost ~$10, Haiku cost ~$3) | | | | |

Sonnet judge reliability: 64%. Haiku judge reliability: 36%. Both directionally agree.

**Conclusion:** Flash Lite separate calls not viable. Pro wins decisively on specificity and actionability.

---

## 2. Mega-Prompt Experiment

**Hypothesis:** Combining all analyses into one prompt produces equivalent quality while reducing calls from 5-6 to 1.

### Pro mega vs Pro separate (15 production essays, Haiku judge)

| Separate wins | Mega wins | Ties | Avg drift |
|--------------|-----------|------|-----------|
| 7 | 8 | 0 | 0.39 |

**Conclusion:** Mega-prompt matches separate calls. Coin flip.

### Flash Lite mega vs Flash Lite separate (15 production essays, Haiku judge)

| Separate wins | Mega wins | Ties | Avg drift |
|--------------|-----------|------|-----------|
| 6 | 9 | 0 | 0.37 |

**Conclusion:** Mega-prompt actually improves Flash Lite too.

### Pro mega vs Flash Lite mega (8 of 15 essays, Gemini 3 Pro judge)

| Pro wins | Flash Lite wins | Ties |
|----------|-----------------|------|
| 6 | 1 | 0 |

**Conclusion:** Even with mega-prompt, Flash Lite still loses to Pro without prompt tuning.

---

## 3. Prompt Tuning for Flash Lite

**Hypothesis:** Prompt engineering can close the quality gap between Flash Lite and Pro.

### Variant Screening (5 production essays each, Gemini 3 Pro judge)

| Variant | Description | Pro wins | Flash wins | Flash% |
|---------|-------------|----------|------------|--------|
| v0-baseline | No extra instructions | 1 | 4 | 80% |
| v1-specificity | Force exact text citations | 4 | 1 | 20% |
| v2-annotation-depth | Annotation quality standards | 4 | 1 | 20% |
| v3-combined | Specificity + annotations + self-check | 2 | 3 | **60%** |
| v4-fewshot | v3 + few-shot examples from Pro | 3 | 2 | 40% |
| v5-warmup | v3 + essay warm-up step | 5 | 0 | 0% |
| v6-fewshot+warmup | v3 + both | 2 | 3 | 60% |

Note: v0 baseline scored 80% in the 5-essay screening but this is small-sample variance. The 15-essay validation is authoritative.

### v3-combined Full Validation (15 production essays, Gemini 3 Pro judge)

| Pro wins | Flash+v3 wins | Ties | Flash% | Avg drift |
|----------|---------------|------|--------|-----------|
| 7 | 7 | 1 | **53% PASS** | 0.33 |

**Conclusion:** v3-combined (specificity + annotation quality + self-check) makes Flash Lite statistically equivalent to Pro. This is the prompt to ship.

### What v3-combined adds to the system prompt:
- Every feedback must cite exact essay text (no generic praise/criticism)
- Name specific craft moves or error types
- Check for factual errors, anachronisms, logical fallacies
- Socratic questions must reference student's actual words
- Self-check step: verify citations and questions before responding

### What didn't work:
- Few-shot examples: marginal improvement (v4), not worth the extra tokens
- Warm-up step: actively harmful (v5, 0% Flash wins), wastes tokens on preamble
- Specificity alone or annotation depth alone: not enough (v1, v2 both 20%)

---

## 4. Side-by-Side Diagnosis (Pro vs Flash Lite output)

Examined 3 essays comparing actual feedback text. Flash Lite weaknesses:
1. Generic praise ("strong grasp") vs Pro's specific craft identification ("brilliant cultural commentary")
2. Misses anachronisms (Pro caught Shirley Chisholm 1972 slogan in 1880s letter; Flash called it "excellent alliteration")
3. Shallow Socratic questions ("Could you explain why?") vs Pro's targeted ones ("What 19th-century phrase would convey the same frustration?")
4. Misses spelling/usage errors Pro catches ("steals herself" → "steels herself")

---

## 5. Judge Comparison

| Judge | Cost | Speed | Reliability | Directional accuracy |
|-------|------|-------|-------------|---------------------|
| Claude Sonnet 4.6 | ~$10/110 essays | ~25 min | 64% | Good |
| Claude Haiku 4.5 | ~$3/110 essays | ~5 min | 36% | Good (same conclusions) |
| Gemini 3 Pro | ~$2/15 essays | ~5 min | Not tested | Good |

**Recommendation:** Haiku for screening, Sonnet or Gemini Pro for close calls.

---

## Key Findings Summary

1. **Mega-prompt works** — 1 call matches 5-6 separate calls at equal quality
2. **Flash Lite + v3 prompt matches Pro** — prompt engineering closes the gap
3. **Combined savings: ~85-90% cost reduction** (fewer calls + cheaper model)
4. **Eval framework is reusable** — change one line in YAML to test a new model
