# Autotune: Iterative Prompt Tuning

Adapted from karpathy/autoresearch. An agent edits `functions/src/prompt.ts`, runs an eval, keeps or discards via git, repeats.

## Setup

```bash
# From the repo root, compile functions first
cd functions && npx tsc

# Generate Pro baseline (one time, ~5 Gemini Pro calls)
cd eval/autotune
GEMINI_API_KEY=xxx npx tsx generate-baseline.ts
```

## Running the tuning loop

Option A -- paste `program.md` into a Claude Code session:
```bash
# Open Claude Code, paste the contents of program.md
```

Option B -- use `--print` for headless:
```bash
GEMINI_API_KEY=xxx claude --print "$(cat eval/autotune/program.md)"
```

## How it works

1. Agent reads `functions/src/prompt.ts` and the current eval score
2. Reads `results.tsv` to see what's been tried
3. Proposes ONE specific change to the prompt
4. Edits `functions/src/prompt.ts`
5. Runs eval: `npx tsx run-eval.ts`
6. If score improved: git commit. If not: git checkout.
7. Logs result to `results.tsv`
8. Repeats until interrupted

## Files

- `program.md` -- Agent instructions (the meta-prompt)
- `run-eval.ts` -- Evaluation harness (runs Flash Lite + judge, outputs SCORE: 0.XX)
- `generate-baseline.ts` -- One-time script to cache Pro mega-prompt outputs
- `baseline-pro.json` -- Cached Pro outputs (generated, not checked in)
- `results.tsv` -- Experiment log (agent appends to this)

## Cost

Each iteration: 5 Flash Lite calls + 5 judge calls = ~10 Gemini calls.
At current pricing, roughly $0.01-0.05 per iteration.
