# Essay Grader

## Project Overview
React + Firebase + Gemini essay evaluator using 6+1 Traits of Writing model. Scores essays 1-6 on Ideas, Organization, Voice, Word Choice, Sentence Fluency, Conventions, and Presentation. Provides Socratic-style annotations for guided student revision.

## Deploying

Use the smart deploy script instead of raw `firebase deploy`:

```bash
cd functions
./scripts/smart-deploy.sh          # only deploys functions whose source changed
./scripts/smart-deploy.sh --dry    # preview what would deploy
./scripts/smart-deploy.sh --all    # force deploy everything
```

Firebase project: `essay-grader-83737x`

## Testing the Rubric

```bash
cd functions
GEMINI_API_KEY=$(firebase functions:secrets:access GEMINI_API_KEY --project essay-grader-83737x 2>/dev/null) \
  npx tsx scripts/test-evaluate.ts test-essays/<file> --type argumentative --prompt "..."
```

Calibration test essays are in `functions/test-essays/`. Sources: Oregon DOE, ACT, CCSS Appendix C.

## Key Files

- `functions/src/prompt.ts` — The rubric (system prompt, evaluation prompt builder, resubmission prompt builder)
- `functions/src/gemini.ts` — Gemini API integration
- `functions/src/submitEssay.ts` — First submission handler
- `functions/src/resubmitDraft.ts` — Revision submission handler
- `functions/scripts/test-evaluate.ts` — CLI test harness for rubric calibration
