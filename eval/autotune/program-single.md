# autotune — single iteration

You are an autonomous cost optimization agent. Do ONE experiment, then exit.

## Step 1: Read current state

Read these files:
- `eval/autotune/results.tsv` — what's been tried
- `eval/autotune/config.json` — current best config
- `git log --oneline autotune/apr4 -10` — recent experiments

Then read the source files you need for context (only the ones relevant to your experiment):
- `functions/src/onDraftCreated.ts`, `functions/src/streamGemini.ts`, `functions/src/megaPrompt.ts`
- Analysis files: `functions/src/grammar.ts`, `functions/src/transitions.ts`, `functions/src/promptAdherence.ts`, `functions/src/duplication.ts`, `functions/src/synthesizeCoach.ts`, `functions/src/prompt.ts`
- Eval harness (read-only): `eval/autotune/run-config-eval.ts`, `eval/validate-full-output.ts`

## Step 2: Plan ONE experiment

Based on results.tsv, pick the most promising thing to try next. ONE change only.

**Goal: lowest cost while passing the validator.** Cost drivers:
- Model: `gemini-3.1-pro-preview` ($$) > `gemini-3-flash-preview` ($) > `gemini-2.5-flash` (¢) > `gemini-3.1-flash-lite-preview` (¢)
- Fewer API calls = cheaper. Local Ollama models = $0.
- Shorter prompts = fewer input tokens.

**You CAN modify**: any file in `functions/src/`, `eval/autotune/config.json`
**You CANNOT modify**: `eval/autotune/run-config-eval.ts`, `eval/validate-full-output.ts`

## Step 3: Implement and test

1. Make your ONE change.
2. `git add` changed files, `git commit -m "tune: <description>"`
3. Compile and run:
```bash
cd functions && npx tsc && cd ../eval/autotune && GEMINI_API_KEY=$GEMINI_API_KEY OPENAI_API_KEY=$OPENAI_API_KEY npx tsx run-config-eval.ts > run.log 2>&1
```
4. Check: `grep "^PASS_RATE:\|^FAILURES:" run.log`
5. If crashed: `tail -50 run.log`, try to fix.

## Step 4: Progressive validation

- **Tier 1 (3 essays)**: the default run above. If this fails, discard immediately.
- **Tier 2 (10 essays)**: if Tier 1 passes AND this is a promising config, run on 10 essays. Modify run-config-eval.ts call to use more essays — or run the validator manually on a wider set.
- **Tier 3 (50 essays)**: only for the BEST overall config. The shipping gate.

## Step 5: Keep or discard

- If passes AND cheaper than current best: keep the commit, update results.tsv
- Otherwise: `git reset --hard HEAD~1`, update results.tsv with "discarded"

**Do NOT commit results.tsv** — it's in .gitignore.

## Step 6: Exit

After ONE experiment (kept or discarded), report what you tried and the result, then stop. The outer loop will launch you again for the next iteration.

## Available local models (Ollama, $0)

- gemma4:latest (9.6GB, best local option)
- gemma3:12b, gemma3:4b, gemma3n
- llama3.1:8b, llama3.2:3b, qwen2.5:7b

Ollama API: `curl http://localhost:11434/api/generate -d '{"model":"gemma4","prompt":"...","system":"...","format":"json","stream":false}'`

Note: local models struggle with complex JSON schemas. Only reliable for duplication analysis so far.

## Known results (don't repeat these)

Read results.tsv for full history. Key findings:
- 2.5-flash handles ALL analyses including transitions (with transBoost instructions)
- transBoost + production sentence formatting → 19/19 on full validation
- gemma4 local works for duplication only
- OpenAI (gpt-4o-mini, gpt-4.1-nano) worse than Gemini for this task
- Best config so far: 3 calls (eval+dup FL, gram+prompt+trans 2.5-flash, coach FL) ~92% savings
- NEEDS Tier 2/3 validation on wider essay sets
