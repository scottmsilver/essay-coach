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

## Design System
Always read DESIGN.md before making any visual or UI decisions.
All font choices, colors, spacing, and aesthetic direction are defined there.
Do not deviate without explicit user approval.
In QA mode, flag any code that doesn't match DESIGN.md.

## gstack

Use the `/browse` skill from gstack for all web browsing. Never use `mcp__chrome-devtools__*` tools.

Available skills: `/office-hours`, `/plan-ceo-review`, `/plan-eng-review`, `/plan-design-review`, `/design-consultation`, `/review`, `/ship`, `/land-and-deploy`, `/canary`, `/benchmark`, `/browse`, `/qa`, `/qa-only`, `/design-review`, `/setup-browser-cookies`, `/setup-deploy`, `/retro`, `/investigate`, `/document-release`, `/codex`, `/cso`, `/autoplan`, `/careful`, `/freeze`, `/guard`, `/unfreeze`, `/gstack-upgrade`.

## Skill routing

When the user's request matches an available skill, ALWAYS invoke it using the Skill
tool as your FIRST action. Do NOT answer directly, do NOT use other tools first.
The skill has specialized workflows that produce better results than ad-hoc answers.

Key routing rules:
- Product ideas, "is this worth building", brainstorming → invoke office-hours
- Bugs, errors, "why is this broken", 500 errors → invoke investigate
- Ship, deploy, push, create PR → invoke ship
- QA, test the site, find bugs → invoke qa
- Code review, check my diff → invoke review
- Update docs after shipping → invoke document-release
- Weekly retro → invoke retro
- Design system, brand → invoke design-consultation
- Visual audit, design polish → invoke design-review
- Architecture review → invoke plan-eng-review
