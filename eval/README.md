# Essay Grader Model Evaluation

Compares Gemini model outputs for essay grading using Promptfoo.

## Prerequisites

- Node.js 22+
- `GEMINI_API_KEY` — local Gemini API key (not from Firebase secrets)
- `ANTHROPIC_API_KEY` — for Claude judge calls
- Firebase Application Default Credentials (`gcloud auth application-default login`)

## Setup

```bash
cd eval
npm install
```

## Usage

```bash
# 1. Export production data from Firestore
npm run export

# 2. Build calibration dataset from test essays
npm run calibration

# 3. Run evaluation (both models, both tracks)
GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npm run eval -- -o promptfoo-output.json

# 4. Run Claude judge on results
ANTHROPIC_API_KEY=xxx npm run judge

# 5. View interactive comparison UI
npm run view
```

## Date-filtered export

```bash
npx tsx export-firestore.ts --from 2026-01-01 --to 2026-03-31
```

## Adding a new model

1. Add a provider entry in `promptfooconfig.yaml`
2. Run `npm run eval`
3. Run `npm run judge`
4. Compare in the UI with `npm run view`

## Acceptance criteria

| Metric | Threshold |
|--------|-----------|
| Schema pass rate | >= 95% |
| Judge feedback quality delta | <= 0.5 avg |
| Judge annotation Socratic delta | <= 0.5 avg |
| Pairwise preference | Challenger wins/ties >= 40% |
| Latency | Informational |
| Cost | Informational |
| Score drift | Informational |
