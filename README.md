# EssayCoach

An AI-powered essay grading tool that uses the **6+1 Traits of Writing** model to score student essays and provide Socratic-style feedback for guided revision.

Built with React, Firebase, Google Gemini, and Mantine.

## Features

- **6+1 Traits scoring** — Ideas, Organization, Voice, Word Choice, Sentence Fluency, Conventions, and Presentation scored 1–6
- **Inline annotations** — Quoted passages with Socratic comments to guide student thinking
- **Grammar analysis** — Comma splices, fragments, run-ons, subject-verb agreement, passive voice, wordiness, and more
- **Transition analysis** — Sentence and paragraph transition quality (smooth/adequate/weak/missing)
- **Revision workflow** — Submit revised drafts, track score changes, and see what improved
- **Essay sharing** — Share essays with classmates or teachers via email
- **Progress tracking** — Dashboard showing writing trends across essays

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, TypeScript 5.9, Vite 8, Mantine 8 |
| Backend | Firebase Cloud Functions (Node 22) |
| AI | Google Gemini (`@google/genai`) |
| Database | Cloud Firestore |
| Auth | Firebase Auth (Google OAuth) |
| Hosting | Firebase Hosting |
| Testing | Vitest, Testing Library |

## Setup

### Prerequisites

- Node.js 18+ (functions require Node 22)
- Firebase CLI (`npm install -g firebase-tools`)

### Install

```bash
npm install
cd functions && npm install
```

### Configure

```bash
cp .env.example .env.local
```

Fill in your Firebase project values:

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

The Gemini API key is managed as a Firebase secret:

```bash
firebase functions:secrets:set GEMINI_API_KEY
```

### Run locally

```bash
npm run dev
```

### Test

```bash
# Frontend tests
npm test

# Cloud function tests
cd functions && npm test
```

### Calibrate the rubric

Test essays from Oregon DOE, ACT, and CCSS Appendix C are in `functions/test-essays/`:

```bash
cd functions
GEMINI_API_KEY=$(firebase functions:secrets:access GEMINI_API_KEY --project essay-grader-83737x 2>/dev/null) \
  npx tsx scripts/test-evaluate.ts test-essays/<file> --type argumentative --prompt "..."
```

## Deploy

### Frontend

```bash
npm run build
firebase deploy --only hosting
```

### Cloud Functions

Use the smart deploy script — it only deploys functions whose source files changed:

```bash
cd functions
./scripts/smart-deploy.sh          # deploy changed functions
./scripts/smart-deploy.sh --dry    # preview what would deploy
./scripts/smart-deploy.sh --all    # force deploy everything
```

## Project Structure

```
src/
  pages/          # EssayPage, RevisionPage, HomePage, ProgressPage, etc.
  components/     # AnnotatedEssay, GrammarView, TransitionView, ScorePillBar, DocBar
  hooks/          # useEssay, useAuth, useActiveMarker, useCommentLayout
  utils/          # sentenceSplitter, pasteHandler
  types.ts        # TypeScript type definitions
  firebase.ts     # Firebase initialization

functions/src/
  prompt.ts       # The 6+1 Traits rubric (system prompt + evaluation prompts)
  gemini.ts       # Gemini API integration
  submitEssay.ts  # First submission handler
  resubmitDraft.ts # Revision submission handler
  evaluateEssay.ts # Essay evaluation (with force re-evaluate support)
  analyzeTransitions.ts # Transition quality analysis
  analyzeGrammar.ts     # Grammar error detection
  grammar.ts      # Grammar analysis with Gemini
  transitions.ts  # Transition analysis with Gemini
```

## Data Model

Essays are stored per-user in Firestore:

```
users/{uid}/essays/{essayId}
  ├── title, writingType, assignmentPrompt, currentDraftNumber
  └── drafts/{draftId}
        ├── content, draftNumber, submittedAt
        ├── evaluation          # 6+1 Traits scores + annotations
        ├── transitionAnalysis  # Sentence/paragraph transitions
        └── grammarAnalysis     # Grammar issues by category
```

## License

Private project.
