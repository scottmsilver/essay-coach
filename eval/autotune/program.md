# autotune

This is an experiment to have the LLM optimize its own API cost.

## Setup

To set up a new experiment, work with the user to:

1. **Agree on a run tag**: propose a tag based on today's date (e.g. `apr4`). The branch `autotune/<tag>` must not already exist — this is a fresh run.
2. **Create the branch**: `git checkout -b autotune/<tag>` from current HEAD.
3. **Read the in-scope files**: The relevant code is small. Read these files for full context:
   - `eval/autotune/README.md` — what this is.
   - `eval/autotune/run-config-eval.ts` — fixed evaluation harness. Do not modify.
   - `eval/validate-full-output.ts` — fixed validator. Do not modify.
   - `functions/src/onDraftCreated.ts` — the orchestrator that dispatches analyses. This is where model choices and call grouping live.
   - `functions/src/streamGemini.ts` — the Gemini call wrapper. Model is already parameterized.
   - `functions/src/gemini.ts` — evaluateWithGemini. Model is parameterized.
   - `functions/src/prompt.ts` — the 6+1 Traits evaluation rubric (306 lines).
   - `functions/src/grammar.ts` — grammar analysis prompt + schema.
   - `functions/src/transitions.ts` — transition analysis prompt + schema.
   - `functions/src/promptAdherence.ts` — prompt adherence prompt + schema.
   - `functions/src/duplication.ts` — duplication analysis prompt + schema.
   - `functions/src/synthesizeCoach.ts` — coach synthesis prompt + schema.
   - `functions/src/megaAnalyze.ts` — mega-prompt handler (combines all 6, currently behind feature flag).
   - `functions/src/megaPrompt.ts` — combined system prompt + schema.
4. **Verify data exists**: Check that `eval/datasets/production.json` exists and has ~89 drafts.
5. **Initialize results.tsv**: Create `results.tsv` with just the header row. The baseline will be recorded after the first run.
6. **Confirm and go**: Confirm setup looks good.

Once you get confirmation, kick off the experimentation.

## Experimentation

Each experiment runs the evaluation harness against 3 production essays. You launch it simply as:

```bash
cd functions && npx tsc && cd ../eval/autotune && GEMINI_API_KEY=$GEMINI_API_KEY npx tsx run-config-eval.ts
```

**What you CAN do:**
- Modify any file in `functions/src/` — prompts, schemas, model names, call grouping, the orchestrator, the mega-prompt handler. Everything is fair game.
- Modify `eval/autotune/config.json` — model assignments per analysis.

**What you CANNOT do:**
- Modify `eval/autotune/run-config-eval.ts`. It is read-only. It contains the fixed evaluation harness.
- Modify `eval/validate-full-output.ts`. It is read-only. It contains the ground truth validator.
- Install new packages or add dependencies.
- Modify frontend code, Firestore rules, or anything outside `functions/src/`.

**The goal is simple: get the lowest cost while passing the validator 3/3.** Since the validator checks transition coverage, grammar completeness, prompt matrix, and coach synthesis, you can't cheat by dropping analyses. The only way to lower cost is to use cheaper models, combine calls, shorten prompts, or find other efficiencies.

Cost drivers (most to least expensive):
- Model choice: `gemini-3.1-pro-preview` ($$) > `gemini-3-flash-preview` ($) > `gemini-2.5-flash` (¢) > `gemini-3.1-flash-lite-preview` (¢)
- Call count: fewer calls = less input token duplication (essay text resent each call)
- Prompt length: shorter system prompts = fewer input tokens per call

**Simplicity criterion**: All else being equal, simpler is better. Removing code and maintaining the pass rate is a great outcome. Adding complexity for marginal cost savings is not worth it. When evaluating whether to keep a change, weigh the complexity cost against the savings.

**The first run**: Your very first run should always be to establish the baseline with the current code as-is.

## Output format

The eval script prints results and ends with:

```
PASS_RATE: 3/3
COST_ESTIMATE: ~$X.XX per essay
FAILURES: none
```

You can extract the key metrics from the log:

```
grep "^PASS_RATE:\|^FAILURES:" run.log
```

## Logging results

When an experiment is done, log it to `results.tsv` (tab-separated).

The TSV has a header row and 5 columns:

```
commit	pass_rate	cost_estimate	status	description
```

1. git commit hash (short, 7 chars)
2. pass_rate (e.g. 3/3, 2/3, 0/3)
3. cost estimate per essay (e.g. $0.05)
4. status: `keep`, `discard`, or `crash`
5. short text description of what this experiment tried

Example:

```
commit	pass_rate	cost_estimate	status	description
a1b2c3d	3/3	$0.12	keep	baseline - all Pro separate calls
b2c3d4e	3/3	$0.07	keep	Flash Lite for eval+dup+coach
c3d4e5f	1/3	$0.03	discard	all Flash Lite (transitions failed)
d4e5f6g	0/3	$0.00	crash	mega-prompt all 6 (overloaded model)
```

## The experiment loop

LOOP FOREVER:

1. Look at the git state: the current branch/commit we're on.
2. Edit code with an experimental idea.
3. git commit.
4. Compile and run: `cd functions && npx tsc && cd ../eval/autotune && GEMINI_API_KEY=$GEMINI_API_KEY npx tsx run-config-eval.ts > run.log 2>&1`
5. Read results: `grep "^PASS_RATE:\|^FAILURES:" run.log`
6. If grep is empty, the run crashed. Run `tail -n 50 run.log` and attempt a fix.
7. Record the results in the TSV (NOTE: do not commit results.tsv, leave it untracked).
8. If pass_rate is 3/3 AND cost is lower than current best: keep the commit (advance the branch).
9. If pass_rate < 3/3 OR cost is higher: `git reset --hard HEAD~1` (discard).

**Crashes**: If a run crashes due to a typo or import error, fix and re-run. If the idea is fundamentally broken, discard and move on.

**NEVER STOP**: Once the experiment loop has begun, do NOT pause to ask the human if you should continue. Do NOT ask "should I keep going?". The human might be asleep and expects you to continue working *indefinitely* until manually stopped. You are autonomous. If you run out of ideas, think harder — re-read the source files, try combining near-misses, try more radical changes. The loop runs until the human interrupts you, period.

Each experiment takes ~1-2 minutes. You can run ~30-60 per hour, ~200-400 overnight.

## What we know so far

From today's experiments (seed knowledge to avoid repeating failures):

**Works:**
- Flash Lite for evaluation (with v3 quality boost added to system prompt) — matches Pro quality
- Flash Lite for duplication — lightweight analysis, Flash handles fine
- Flash Lite for coach synthesis — lightweight, just aggregates other results

**Fails:**
- Flash Lite for transitions — returns 2 sentence transitions instead of ~50. Coverage way too sparse.
- Flash Lite for grammar — misses errors entirely when running as part of mega-prompt.
- Mega-prompt (all 6 in one call) — overloads ANY model including Pro. Transitions and grammar get sparse.
- 3-in-1 combo (grammar+transitions+prompt in one Pro call) — also degrades transitions.

**Not yet tested (promising):**
- `gemini-3-flash-preview` for transitions or grammar (bigger than Flash Lite)
- `gemini-2.5-flash` for grammar (cheap, structured extraction task)
- `gemini-2.5-pro` for transitions (cheaper than 3.1 Pro)
- v3 quality boost on grammar or transitions specifically
- 2-in-1 combos: eval+dup, dup+coach (lightweight pairs)
- Shorter evaluation prompt (306 lines — does Flash need all of it?)
- Context caching (Gemini feature — send essay once, reuse across calls)
