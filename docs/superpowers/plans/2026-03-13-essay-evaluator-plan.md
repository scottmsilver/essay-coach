# Jago-Style Essay Evaluator Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a web app where high school students submit essays and receive Jago-style 6+1 Traits feedback with guided, staged revision.

**Architecture:** React frontend served by Firebase Hosting. Firebase Cloud Functions handle essay evaluation via the Gemini API and write results to Firestore. Firebase Auth (Google only) with an email allowlist gates access. The frontend shows trait-based feedback in a grid view and a side-by-side revision editor with quoted-text highlights.

**Tech Stack:** React 18 + TypeScript + Vite, Firebase (Auth, Firestore, Cloud Functions, Hosting), Gemini API (`gemini-3.1-pro-preview`), Recharts (progress charts), React Router v6, Vitest + React Testing Library

**Spec:** `docs/superpowers/specs/2026-03-13-essay-evaluator-design.md`

**Testing approach:** TDD everywhere. Every task starts with a failing test, then implements the minimum code to pass. Backend uses Vitest with mocked Firebase Admin + Gemini. Frontend uses Vitest + React Testing Library with mocked Firebase client SDK.

---

## File Structure

```
essay-grader/
├── package.json
├── vite.config.ts
├── tsconfig.json
├── index.html
├── .firebaserc
├── firebase.json
├── firestore.rules
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── firebase.ts
│   ├── types.ts
│   ├── utils.ts
│   ├── setupTests.ts
│   ├── test-utils.tsx                    # Shared test wrapper (AuthProvider mock, Router)
│   ├── components/
│   │   ├── Layout.tsx
│   │   ├── Layout.test.tsx
│   │   ├── ProtectedRoute.tsx
│   │   ├── ProtectedRoute.test.tsx
│   │   ├── TraitCard.tsx
│   │   ├── TraitCard.test.tsx
│   │   ├── RevisionPlanBanner.tsx
│   │   ├── RevisionPlanBanner.test.tsx
│   │   ├── DraftSelector.tsx
│   │   ├── DraftSelector.test.tsx
│   │   ├── AnnotatedEssay.tsx
│   │   ├── AnnotatedEssay.test.tsx
│   │   ├── ScoreDelta.tsx
│   │   └── ScoreDelta.test.tsx
│   ├── pages/
│   │   ├── LoginPage.tsx
│   │   ├── LoginPage.test.tsx
│   │   ├── HomePage.tsx
│   │   ├── HomePage.test.tsx
│   │   ├── NewEssayPage.tsx
│   │   ├── NewEssayPage.test.tsx
│   │   ├── EssayPage.tsx
│   │   ├── EssayPage.test.tsx
│   │   ├── RevisionPage.tsx
│   │   ├── RevisionPage.test.tsx
│   │   ├── ProgressPage.tsx
│   │   └── ProgressPage.test.tsx
│   ├── hooks/
│   │   ├── useAuth.tsx
│   │   ├── useEssays.ts
│   │   └── useEssay.ts
│   └── index.css
├── functions/
│   ├── package.json
│   ├── tsconfig.json
│   ├── src/
│   │   ├── index.ts
│   │   ├── submitEssay.ts
│   │   ├── resubmitDraft.ts
│   │   ├── deleteAccount.ts
│   │   ├── allowlist.ts
│   │   ├── validation.ts
│   │   ├── gemini.ts
│   │   └── prompt.ts
│   └── tests/
│       ├── validation.test.ts
│       ├── prompt.test.ts
│       ├── allowlist.test.ts
│       ├── gemini.test.ts
│       ├── submitEssay.test.ts
│       └── resubmitDraft.test.ts
├── scripts/
│   └── seed-allowlist.ts
└── docs/
    └── superpowers/
        ├── specs/
        │   └── 2026-03-13-essay-evaluator-design.md
        └── plans/
            └── 2026-03-13-essay-evaluator-plan.md
```

---

## Chunk 1: Project Scaffolding & Firebase Setup

### Task 1: Initialize React + Vite + TypeScript project

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`, `src/main.tsx`, `.gitignore`

- [ ] **Step 1: Scaffold Vite project**

Run:
```bash
cd /home/ssilver/development/essay-grader
npm create vite@latest . -- --template react-ts
```

- [ ] **Step 2: Install frontend dependencies**

Run:
```bash
npm install firebase react-router-dom recharts
npm install -D @types/react @types/react-dom vitest @testing-library/react @testing-library/jest-dom @testing-library/user-event jsdom
```

- [ ] **Step 3: Configure Vitest in vite.config.ts**

Update `vite.config.ts`:
```typescript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/setupTests.ts',
  },
})
```

Create `src/setupTests.ts`:
```typescript
import '@testing-library/jest-dom'
```

- [ ] **Step 4: Verify project builds**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 5: Commit**

```bash
git init
git add package.json package-lock.json vite.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json index.html src/ .gitignore
git commit -m "chore: scaffold React + Vite + TypeScript project"
```

---

### Task 2: Initialize Firebase

**Files:**
- Create: `firebase.json`, `.firebaserc`, `firestore.rules`, `functions/`

- [ ] **Step 1: Install Firebase CLI if not present**

Run:
```bash
npx firebase-tools --version || npm install -g firebase-tools
```

- [ ] **Step 2: Initialize Firebase project**

Run:
```bash
npx firebase-tools init
```

Select: Firestore, Functions (TypeScript), Hosting (`dist`, SPA rewrites).

- [ ] **Step 3: Install functions dependencies**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions
npm install @google/genai
npm install -D vitest
cd /home/ssilver/development/essay-grader
```

Add to `functions/package.json` scripts:
```json
"test": "vitest run",
"test:watch": "vitest"
```

- [ ] **Step 4: Create minimal functions/src/index.ts**

```typescript
export {};
```

- [ ] **Step 5: Verify functions compile**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm run build && cd /home/ssilver/development/essay-grader
```

Expected: Compiles.

- [ ] **Step 6: Add .superpowers/ to .gitignore**

Append `.superpowers/` to `.gitignore`.

- [ ] **Step 7: Commit**

```bash
git add firebase.json .firebaserc firestore.rules firestore.indexes.json functions/ .gitignore
git commit -m "chore: initialize Firebase (Firestore, Functions, Hosting)"
```

---

### Task 3: Firestore Security Rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Write Firestore security rules**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      match /essays/{essayId} {
        allow read, write: if request.auth != null && request.auth.uid == uid;

        match /drafts/{draftId} {
          allow read: if request.auth != null && request.auth.uid == uid;
          allow create: if request.auth != null && request.auth.uid == uid
                        && !("evaluation" in request.resource.data);
          allow update: if request.auth != null && request.auth.uid == uid
                        && (!("evaluation" in request.resource.data)
                            || (request.resource.data.diff(resource.data).affectedKeys()
                                .hasOnly(["revisionStage"])
                                && (request.resource.data.revisionStage is number
                                    || request.resource.data.revisionStage == null)));
        }
      }
    }

    match /config/{doc} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add firestore.rules
git commit -m "feat: add Firestore security rules with draft/evaluation protection"
```

---

### Task 4: Shared TypeScript Types

**Files:**
- Create: `src/types.ts`, `src/utils.ts`

- [ ] **Step 1: Define all shared types**

Create `src/types.ts`:
```typescript
export const WRITING_TYPES = [
  'argumentative', 'narrative', 'expository',
  'persuasive', 'analytical', 'informational',
] as const;

export type WritingType = typeof WRITING_TYPES[number];

export const TRAIT_KEYS = [
  'ideas', 'organization', 'voice', 'wordChoice',
  'sentenceFluency', 'conventions', 'presentation',
] as const;

export type TraitKey = typeof TRAIT_KEYS[number];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  ideas: 'Ideas',
  organization: 'Organization',
  voice: 'Voice',
  wordChoice: 'Word Choice',
  sentenceFluency: 'Sentence Fluency',
  conventions: 'Conventions',
  presentation: 'Presentation',
};

export interface Annotation {
  quotedText: string;
  comment: string;
}

export interface TraitEvaluation {
  score: number;
  feedback: string;
  revisionPriority: number | null;
  annotations: Annotation[];
}

export interface ScoreChange {
  previous: number;
  current: number;
  delta: number;
}

export interface Comparison {
  scoreChanges: Partial<Record<TraitKey, ScoreChange>>;
  improvements: string[];
  remainingIssues: string[];
}

export interface Evaluation {
  traits: Record<TraitKey, TraitEvaluation>;
  overallFeedback: string;
  revisionPlan: string[];
  comparisonToPrevious: Comparison | null;
}

export interface Draft {
  id: string;
  draftNumber: number;
  content: string;
  submittedAt: Date;
  evaluation: Evaluation | null;
  revisionStage: number | null;
}

export interface Essay {
  id: string;
  title: string;
  assignmentPrompt: string;
  writingType: WritingType;
  createdAt: Date;
  updatedAt: Date;
  currentDraftNumber: number;
}

export interface UserProfile {
  displayName: string;
  email: string;
  createdAt: Date;
}
```

- [ ] **Step 2: Create shared utils**

Create `src/utils.ts`:
```typescript
export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function scoreClass(score: number): 'score-low' | 'score-mid' | 'score-high' {
  if (score <= 2) return 'score-low';
  if (score === 3) return 'score-mid';
  return 'score-high';
}

export function scoreColor(score: number): string {
  if (score <= 2) return 'var(--color-red)';
  if (score === 3) return 'var(--color-yellow)';
  return 'var(--color-green)';
}
```

- [ ] **Step 3: Commit**

```bash
git add src/types.ts src/utils.ts
git commit -m "feat: add shared TypeScript types and utils"
```

---

## Chunk 2: Cloud Functions Backend (TDD)

### Task 5: Validation Helpers

**Files:**
- Create: `functions/src/validation.ts`
- Create: `functions/tests/validation.test.ts`

- [ ] **Step 1: Write failing tests**

Create `functions/tests/validation.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { validateSubmitEssay, validateResubmitDraft, countWords } from '../src/validation';

describe('countWords', () => {
  it('counts words in a simple sentence', () => {
    expect(countWords('Hello world foo bar')).toBe(4);
  });
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });
  it('handles extra whitespace', () => {
    expect(countWords('  hello   world  ')).toBe(2);
  });
});

describe('validateSubmitEssay', () => {
  const valid = {
    title: 'My Essay',
    assignmentPrompt: 'Write about Hamlet',
    writingType: 'argumentative',
    content: 'This is my essay content.',
  };

  it('accepts valid input', () => {
    expect(validateSubmitEssay(valid)).toBeNull();
  });
  it('rejects missing title', () => {
    expect(validateSubmitEssay({ ...valid, title: '' })).toMatch(/title/i);
  });
  it('rejects title over 200 chars', () => {
    expect(validateSubmitEssay({ ...valid, title: 'a'.repeat(201) })).toMatch(/title/i);
  });
  it('rejects prompt over 2000 chars', () => {
    expect(validateSubmitEssay({ ...valid, assignmentPrompt: 'a'.repeat(2001) })).toMatch(/prompt/i);
  });
  it('rejects invalid writingType', () => {
    expect(validateSubmitEssay({ ...valid, writingType: 'poetry' })).toMatch(/writing type/i);
  });
  it('rejects content over 10000 words', () => {
    const longContent = Array(10001).fill('word').join(' ');
    expect(validateSubmitEssay({ ...valid, content: longContent })).toMatch(/content/i);
  });
  it('rejects empty content', () => {
    expect(validateSubmitEssay({ ...valid, content: '' })).toMatch(/content/i);
  });
});

describe('validateResubmitDraft', () => {
  it('accepts valid input', () => {
    expect(validateResubmitDraft({ essayId: 'abc', content: 'My revised essay.' })).toBeNull();
  });
  it('rejects missing essayId', () => {
    expect(validateResubmitDraft({ essayId: '', content: 'text' })).toMatch(/essayId/i);
  });
  it('rejects empty content', () => {
    expect(validateResubmitDraft({ essayId: 'abc', content: '' })).toMatch(/content/i);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm test && cd /home/ssilver/development/essay-grader
```
Expected: FAIL — modules not found.

- [ ] **Step 3: Implement validation.ts**

Create `functions/src/validation.ts`:
```typescript
const VALID_WRITING_TYPES = [
  'argumentative', 'narrative', 'expository',
  'persuasive', 'analytical', 'informational',
] as const;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

interface SubmitEssayInput {
  title: string;
  assignmentPrompt: string;
  writingType: string;
  content: string;
}

export function validateSubmitEssay(input: SubmitEssayInput): string | null {
  if (!input.title || input.title.trim().length === 0) return 'Title is required';
  if (input.title.length > 200) return 'Title must be 200 characters or fewer';
  if (!input.assignmentPrompt || input.assignmentPrompt.trim().length === 0) return 'Assignment prompt is required';
  if (input.assignmentPrompt.length > 2000) return 'Assignment prompt must be 2,000 characters or fewer';
  if (!VALID_WRITING_TYPES.includes(input.writingType as any)) return `Invalid writing type: ${input.writingType}`;
  if (!input.content || input.content.trim().length === 0) return 'Essay content is required';
  if (countWords(input.content) > 10000) return 'Essay content must be 10,000 words or fewer';
  return null;
}

interface ResubmitDraftInput {
  essayId: string;
  content: string;
}

export function validateResubmitDraft(input: ResubmitDraftInput): string | null {
  if (!input.essayId || input.essayId.trim().length === 0) return 'essayId is required';
  if (!input.content || input.content.trim().length === 0) return 'Essay content is required';
  if (countWords(input.content) > 10000) return 'Essay content must be 10,000 words or fewer';
  return null;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm test && cd /home/ssilver/development/essay-grader
```
Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/validation.ts functions/tests/validation.test.ts
git commit -m "feat: add input validation with tests"
```

---

### Task 6: Allowlist Helper

**Files:**
- Create: `functions/src/allowlist.ts`
- Create: `functions/tests/allowlist.test.ts`

- [ ] **Step 1: Write failing test**

Create `functions/tests/allowlist.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin before importing allowlist
vi.mock('firebase-admin/firestore', () => {
  const mockGet = vi.fn();
  return {
    getFirestore: () => ({
      doc: () => ({ get: mockGet }),
    }),
    __mockGet: mockGet,
  };
});

import { isEmailAllowed } from '../src/allowlist';
import { __mockGet } from 'firebase-admin/firestore';

const mockGet = __mockGet as ReturnType<typeof vi.fn>;

describe('isEmailAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for an email on the allowlist', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com', 'other@gmail.com'] }),
    });
    expect(await isEmailAllowed('test@gmail.com')).toBe(true);
  });

  it('returns false for an email not on the allowlist', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    expect(await isEmailAllowed('hacker@evil.com')).toBe(false);
  });

  it('returns false when allowlist doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await isEmailAllowed('test@gmail.com')).toBe(false);
  });

  it('is case-insensitive', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    expect(await isEmailAllowed('Test@Gmail.com')).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm test && cd /home/ssilver/development/essay-grader
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement allowlist.ts**

Create `functions/src/allowlist.ts`:
```typescript
import { getFirestore } from 'firebase-admin/firestore';

export async function isEmailAllowed(email: string): Promise<boolean> {
  const db = getFirestore();
  const doc = await db.doc('config/allowlist').get();
  if (!doc.exists) return false;
  const emails: string[] = doc.data()?.emails ?? [];
  return emails.includes(email.toLowerCase());
}
```

- [ ] **Step 4: Run tests to verify they pass**

Expected: All PASS.

- [ ] **Step 5: Commit**

```bash
git add functions/src/allowlist.ts functions/tests/allowlist.test.ts
git commit -m "feat: add allowlist helper with tests"
```

---

### Task 7: Gemini Prompt & Client

**Files:**
- Create: `functions/src/prompt.ts`, `functions/src/gemini.ts`
- Create: `functions/tests/prompt.test.ts`, `functions/tests/gemini.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Create `functions/tests/prompt.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildEvaluationPrompt, buildResubmissionPrompt, SYSTEM_PROMPT } from '../src/prompt';

describe('SYSTEM_PROMPT', () => {
  it('includes the 6+1 traits', () => {
    expect(SYSTEM_PROMPT).toContain('Ideas');
    expect(SYSTEM_PROMPT).toContain('Organization');
    expect(SYSTEM_PROMPT).toContain('Voice');
    expect(SYSTEM_PROMPT).toContain('Word Choice');
    expect(SYSTEM_PROMPT).toContain('Sentence Fluency');
    expect(SYSTEM_PROMPT).toContain('Conventions');
    expect(SYSTEM_PROMPT).toContain('Presentation');
  });

  it('includes score descriptors 1-6', () => {
    expect(SYSTEM_PROMPT).toContain('1 -');
    expect(SYSTEM_PROMPT).toContain('6 -');
  });

  it('mentions revision-oriented feedback', () => {
    expect(SYSTEM_PROMPT).toMatch(/revision|revise/i);
  });

  it('mentions Carol Jago', () => {
    expect(SYSTEM_PROMPT).toMatch(/jago/i);
  });
});

describe('buildEvaluationPrompt', () => {
  it('includes the assignment prompt', () => {
    const result = buildEvaluationPrompt({
      assignmentPrompt: 'Write about Hamlet',
      writingType: 'argumentative',
      content: 'My essay...',
    });
    expect(result).toContain('Write about Hamlet');
  });

  it('includes the writing type', () => {
    const result = buildEvaluationPrompt({
      assignmentPrompt: 'Prompt',
      writingType: 'narrative',
      content: 'My essay...',
    });
    expect(result).toContain('narrative');
  });

  it('includes the essay content', () => {
    const result = buildEvaluationPrompt({
      assignmentPrompt: 'Prompt',
      writingType: 'argumentative',
      content: 'The specific essay text here.',
    });
    expect(result).toContain('The specific essay text here.');
  });
});

describe('buildResubmissionPrompt', () => {
  it('includes previous evaluation context', () => {
    const result = buildResubmissionPrompt({
      assignmentPrompt: 'Prompt',
      writingType: 'argumentative',
      content: 'Revised essay...',
      previousEvaluation: '{"traits": {}}',
    });
    expect(result).toContain('previous evaluation');
    expect(result).toContain('Revised essay...');
    expect(result).toContain('comparisonToPrevious');
  });
});
```

- [ ] **Step 2: Write failing Gemini client test**

Create `functions/tests/gemini.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import { evaluateWithGemini } from '../src/gemini';

describe('evaluateWithGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed JSON from Gemini response', async () => {
    const mockEvaluation = {
      traits: {
        ideas: { score: 4, feedback: 'Good', revisionPriority: null, annotations: [] },
        organization: { score: 3, feedback: 'OK', revisionPriority: 1, annotations: [] },
        voice: { score: 5, feedback: 'Great', revisionPriority: null, annotations: [] },
        wordChoice: { score: 3, feedback: 'Needs work', revisionPriority: 2, annotations: [] },
        sentenceFluency: { score: 4, feedback: 'Solid', revisionPriority: null, annotations: [] },
        conventions: { score: 2, feedback: 'Fix', revisionPriority: 3, annotations: [] },
        presentation: { score: 4, feedback: 'Fine', revisionPriority: null, annotations: [] },
      },
      overallFeedback: 'Nice work',
      revisionPlan: ['Fix conventions'],
      comparisonToPrevious: null,
    };

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockEvaluation),
    });

    const result = await evaluateWithGemini('fake-key', 'evaluate this');
    expect(result).toEqual(mockEvaluation);
  });

  it('throws on empty Gemini response', async () => {
    mockGenerateContent.mockResolvedValue({ text: null });
    await expect(evaluateWithGemini('fake-key', 'evaluate this')).rejects.toThrow('empty response');
  });

  it('throws on invalid JSON response', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not json' });
    await expect(evaluateWithGemini('fake-key', 'evaluate this')).rejects.toThrow();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm test && cd /home/ssilver/development/essay-grader
```
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement prompt.ts**

Create `functions/src/prompt.ts`:
```typescript
export const SYSTEM_PROMPT = `You are a supportive but honest writing coach for high school students. Your feedback follows Carol Jago's revision-focused philosophy: tell students what to do to improve, not just what's wrong. Be encouraging about strengths while being specific and actionable about areas for growth.

You evaluate essays using the 6+1 Traits of Writing model. For each trait, provide:
- A score from 1-6
- Written feedback that is specific, actionable, and encouraging
- 1-3 quoted passages from the essay as annotations (verbatim excerpts)

Score Descriptors:
1 - Beginning: The writing lacks this trait almost entirely. Major revision needed.
2 - Emerging: The trait is present but weak. Significant revision needed.
3 - Developing: The trait shows some competence but needs strengthening.
4 - Proficient: The trait is solid with minor areas for improvement.
5 - Strong: The trait is well-developed and effective.
6 - Exceptional: The trait is masterfully executed.

The 7 traits:
- Ideas: The main message, details, and development of the topic
- Organization: The internal structure — introduction, transitions, conclusion
- Voice: The writer's personality and connection to the audience and topic
- Word Choice: The vocabulary and precision of language
- Sentence Fluency: The rhythm and flow of sentences
- Conventions: Grammar, spelling, punctuation, capitalization
- Presentation: Paragraph structure, formatting, and visual organization of the text

For guided revision:
- Identify the 2-4 traits that would most benefit from revision
- Assign them a revisionPriority (1 = fix first, 2 = fix second, etc.)
- Traits with scores of 4 or above should have revisionPriority: null (no revision needed)
- Create a revisionPlan: an ordered list of specific, actionable steps

For annotations:
- Quote 1-3 representative passages from the essay for each trait
- Use exact text from the essay (verbatim)
- Provide a specific comment for each quoted passage

Your feedback tone should be:
- Encouraging but honest
- Specific, not generic ("Your thesis about Hamlet's inaction is compelling" not "Good thesis")
- Action-oriented ("Try combining these two sentences with a semicolon" not "Sentences are choppy")
- Age-appropriate for high school students`;

interface EvaluationInput {
  assignmentPrompt: string;
  writingType: string;
  content: string;
}

export function buildEvaluationPrompt(input: EvaluationInput): string {
  return `Evaluate the following ${input.writingType} essay.

## Assignment Prompt
${input.assignmentPrompt}

## Student Essay
${input.content}

Respond with a JSON object matching this exact schema. Do not include any text outside the JSON.`;
}

interface ResubmissionInput extends EvaluationInput {
  previousEvaluation: string;
}

export function buildResubmissionPrompt(input: ResubmissionInput): string {
  return `Evaluate the following revised ${input.writingType} essay. This is a resubmission — the student has revised their work based on previous feedback.

## Assignment Prompt
${input.assignmentPrompt}

## Student Essay (Revised)
${input.content}

## Previous Evaluation (for comparison)
The student received this previous evaluation. Compare the revised essay to it and note improvements and remaining issues.
${input.previousEvaluation}

Respond with a JSON object matching this exact schema. Include the "comparisonToPrevious" field with scoreChanges, improvements, and remainingIssues. Do not include any text outside the JSON.`;
}
```

- [ ] **Step 5: Implement gemini.ts**

Create `functions/src/gemini.ts`:
```typescript
import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT } from './prompt';

const EVALUATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    traits: {
      type: 'object' as const,
      properties: Object.fromEntries(
        ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'].map(
          (trait) => [
            trait,
            {
              type: 'object' as const,
              properties: {
                score: { type: 'number' as const },
                feedback: { type: 'string' as const },
                revisionPriority: { type: 'number' as const, nullable: true },
                annotations: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      quotedText: { type: 'string' as const },
                      comment: { type: 'string' as const },
                    },
                    required: ['quotedText', 'comment'],
                  },
                },
              },
              required: ['score', 'feedback', 'revisionPriority', 'annotations'],
            },
          ]
        )
      ),
      required: ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'],
    },
    overallFeedback: { type: 'string' as const },
    revisionPlan: { type: 'array' as const, items: { type: 'string' as const } },
    comparisonToPrevious: {
      type: 'object' as const,
      nullable: true,
      properties: {
        scoreChanges: { type: 'object' as const },
        improvements: { type: 'array' as const, items: { type: 'string' as const } },
        remainingIssues: { type: 'array' as const, items: { type: 'string' as const } },
      },
    },
  },
  required: ['traits', 'overallFeedback', 'revisionPlan', 'comparisonToPrevious'],
};

export async function evaluateWithGemini(
  apiKey: string,
  userPrompt: string
): Promise<Record<string, unknown>> {
  const ai = new GoogleGenAI({ apiKey });

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: EVALUATION_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error('Gemini returned an empty response');
  }

  return JSON.parse(text);
}
```

- [ ] **Step 6: Run tests to verify they pass**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm test && cd /home/ssilver/development/essay-grader
```
Expected: All PASS.

- [ ] **Step 7: Commit**

```bash
git add functions/src/prompt.ts functions/src/gemini.ts functions/tests/prompt.test.ts functions/tests/gemini.test.ts
git commit -m "feat: add Gemini prompt engineering and API client with tests"
```

---

### Task 8: submitEssay Cloud Function

**Files:**
- Create: `functions/src/submitEssay.ts`
- Modify: `functions/src/index.ts`
- Create: `functions/tests/submitEssay.test.ts`

- [ ] **Step 1: Write failing test**

Create `functions/tests/submitEssay.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({
  id: 'essay123',
  set: mockSet,
  update: mockUpdate,
  collection: () => ({
    doc: () => ({
      id: 'draft123',
      set: mockSet,
      update: mockUpdate,
    }),
  }),
});
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });
const mockAllowlistGet = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: mockCollection,
    doc: (path: string) => {
      if (path === 'config/allowlist') {
        return { get: mockAllowlistGet };
      }
      return mockDoc(path);
    },
  }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

// Mock Gemini
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

// Mock firebase-functions
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: any, handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'fake-api-key' }),
}));

import { submitEssay } from '../src/submitEssay';

const mockEvaluation = {
  traits: {
    ideas: { score: 4, feedback: 'Good', revisionPriority: null, annotations: [] },
    organization: { score: 3, feedback: 'OK', revisionPriority: 1, annotations: [] },
    voice: { score: 5, feedback: 'Great', revisionPriority: null, annotations: [] },
    wordChoice: { score: 3, feedback: 'Needs work', revisionPriority: 2, annotations: [] },
    sentenceFluency: { score: 4, feedback: 'Solid', revisionPriority: null, annotations: [] },
    conventions: { score: 2, feedback: 'Fix', revisionPriority: 3, annotations: [] },
    presentation: { score: 4, feedback: 'Fine', revisionPriority: null, annotations: [] },
  },
  overallFeedback: 'Nice work',
  revisionPlan: ['Fix conventions'],
  comparisonToPrevious: null,
};

describe('submitEssay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockEvaluation),
    });
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(
      (submitEssay as any)({ auth: null, data: {} })
    ).rejects.toThrow('Must be signed in');
  });

  it('throws permission-denied when email not on allowlist', async () => {
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['other@gmail.com'] }),
    });
    await expect(
      (submitEssay as any)({
        auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
        data: { title: 'T', assignmentPrompt: 'P', writingType: 'argumentative', content: 'Essay text' },
      })
    ).rejects.toThrow('allowlist');
  });

  it('throws invalid-argument for bad input', async () => {
    await expect(
      (submitEssay as any)({
        auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
        data: { title: '', assignmentPrompt: 'P', writingType: 'argumentative', content: 'text' },
      })
    ).rejects.toThrow(/title/i);
  });

  it('creates essay and draft, calls Gemini, returns evaluation', async () => {
    const result = await (submitEssay as any)({
      auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
      data: {
        title: 'Hamlet Analysis',
        assignmentPrompt: 'Analyze Hamlet',
        writingType: 'analytical',
        content: 'Hamlet is a play about inaction.',
      },
    });

    expect(mockSet).toHaveBeenCalled();
    expect(mockGenerateContent).toHaveBeenCalled();
    expect(result.evaluation).toEqual(mockEvaluation);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm test && cd /home/ssilver/development/essay-grader
```
Expected: FAIL — module not found.

- [ ] **Step 3: Implement submitEssay.ts**

Create `functions/src/submitEssay.ts`:
```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { validateSubmitEssay } from './validation';
import { buildEvaluationPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const submitEssay = onCall(
  { timeoutSeconds: 120, secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }

    const { title, assignmentPrompt, writingType, content } = request.data;
    const validationError = validateSubmitEssay({ title, assignmentPrompt, writingType, content });
    if (validationError) {
      throw new HttpsError('invalid-argument', validationError);
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    const essayRef = db.collection(`users/${uid}/essays`).doc();
    await essayRef.set({
      title,
      assignmentPrompt,
      writingType,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      currentDraftNumber: 1,
    });

    const draftRef = essayRef.collection('drafts').doc();
    await draftRef.set({
      draftNumber: 1,
      content,
      submittedAt: FieldValue.serverTimestamp(),
      evaluation: null,
      revisionStage: null,
    });

    try {
      const prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
      const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
      await draftRef.update({ evaluation });
      return { essayId: essayRef.id, evaluation };
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
          const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
          await draftRef.update({ evaluation });
          return { essayId: essayRef.id, evaluation };
        } catch {
          throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
        }
      }
      throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
    }
  }
);
```

- [ ] **Step 4: Update index.ts**

```typescript
import { initializeApp } from 'firebase-admin/app';
initializeApp();
export { submitEssay } from './submitEssay';
```

- [ ] **Step 5: Run tests to verify they pass**

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/submitEssay.ts functions/src/index.ts functions/tests/submitEssay.test.ts
git commit -m "feat: implement submitEssay Cloud Function with tests"
```

---

### Task 9: resubmitDraft Cloud Function

**Files:**
- Create: `functions/src/resubmitDraft.ts`
- Create: `functions/tests/resubmitDraft.test.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write failing test**

Create `functions/tests/resubmitDraft.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockEssayGet = vi.fn();
const mockDraftsGet = vi.fn();
const mockAllowlistGet = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (path === 'config/allowlist') return { get: mockAllowlistGet };
      return {
        get: mockEssayGet,
        update: mockUpdate,
        collection: () => ({
          doc: () => ({ id: 'newdraft1', set: mockSet, update: mockUpdate }),
          where: () => ({ limit: () => ({ get: mockDraftsGet }) }),
        }),
      };
    },
  }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));

const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: any, handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'fake-api-key' }),
}));

import { resubmitDraft } from '../src/resubmitDraft';

const mockEvaluation = {
  traits: {
    ideas: { score: 5, feedback: 'Improved', revisionPriority: null, annotations: [] },
    organization: { score: 4, feedback: 'Better', revisionPriority: null, annotations: [] },
    voice: { score: 5, feedback: 'Great', revisionPriority: null, annotations: [] },
    wordChoice: { score: 4, feedback: 'Improved', revisionPriority: null, annotations: [] },
    sentenceFluency: { score: 4, feedback: 'Solid', revisionPriority: null, annotations: [] },
    conventions: { score: 4, feedback: 'Fixed', revisionPriority: null, annotations: [] },
    presentation: { score: 4, feedback: 'Fine', revisionPriority: null, annotations: [] },
  },
  overallFeedback: 'Much improved',
  revisionPlan: [],
  comparisonToPrevious: {
    scoreChanges: { conventions: { previous: 2, current: 4, delta: 2 } },
    improvements: ['Conventions improved'],
    remainingIssues: [],
  },
};

describe('resubmitDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    mockEssayGet.mockResolvedValue({
      exists: true,
      data: () => ({
        assignmentPrompt: 'Analyze Hamlet',
        writingType: 'analytical',
        currentDraftNumber: 1,
      }),
    });
    mockDraftsGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ evaluation: { traits: {} } }) }],
    });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockEvaluation),
    });
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(
      (resubmitDraft as any)({ auth: null, data: {} })
    ).rejects.toThrow('Must be signed in');
  });

  it('throws not-found when essay does not exist', async () => {
    mockEssayGet.mockResolvedValue({ exists: false });
    await expect(
      (resubmitDraft as any)({
        auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
        data: { essayId: 'nonexistent', content: 'Revised text' },
      })
    ).rejects.toThrow('not found');
  });

  it('creates new draft and returns evaluation with comparison', async () => {
    const result = await (resubmitDraft as any)({
      auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
      data: { essayId: 'essay1', content: 'My revised essay text.' },
    });

    expect(mockSet).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockGenerateContent).toHaveBeenCalled();
    expect(result.draftNumber).toBe(2);
    expect(result.evaluation.comparisonToPrevious).toBeTruthy();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Expected: FAIL — module not found.

- [ ] **Step 3: Implement resubmitDraft.ts**

Create `functions/src/resubmitDraft.ts`:
```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { validateResubmitDraft } from './validation';
import { buildResubmissionPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const resubmitDraft = onCall(
  { timeoutSeconds: 120, secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }

    const { essayId, content } = request.data;
    const validationError = validateResubmitDraft({ essayId, content });
    if (validationError) {
      throw new HttpsError('invalid-argument', validationError);
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    const essayRef = db.doc(`users/${uid}/essays/${essayId}`);
    const essayDoc = await essayRef.get();
    if (!essayDoc.exists) {
      throw new HttpsError('not-found', 'Essay not found');
    }

    const essayData = essayDoc.data()!;
    const { assignmentPrompt, writingType, currentDraftNumber } = essayData;

    const previousDraftsSnapshot = await essayRef
      .collection('drafts')
      .where('draftNumber', '==', currentDraftNumber)
      .limit(1)
      .get();

    if (previousDraftsSnapshot.empty) {
      throw new HttpsError('internal', 'Previous draft not found');
    }

    const previousEvaluation = previousDraftsSnapshot.docs[0].data().evaluation;
    const newDraftNumber = currentDraftNumber + 1;

    const draftRef = essayRef.collection('drafts').doc();
    await draftRef.set({
      draftNumber: newDraftNumber,
      content,
      submittedAt: FieldValue.serverTimestamp(),
      evaluation: null,
      revisionStage: null,
    });

    await essayRef.update({
      currentDraftNumber: newDraftNumber,
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      const prompt = buildResubmissionPrompt({
        assignmentPrompt,
        writingType,
        content,
        previousEvaluation: JSON.stringify(previousEvaluation),
      });
      const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
      await draftRef.update({ evaluation });
      return { draftNumber: newDraftNumber, evaluation };
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const prompt = buildResubmissionPrompt({
            assignmentPrompt, writingType, content,
            previousEvaluation: JSON.stringify(previousEvaluation),
          });
          const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
          await draftRef.update({ evaluation });
          return { draftNumber: newDraftNumber, evaluation };
        } catch {
          throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
        }
      }
      throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
    }
  }
);
```

- [ ] **Step 4: Add export to index.ts**

Add: `export { resubmitDraft } from './resubmitDraft';`

- [ ] **Step 5: Run tests to verify they pass**

Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add functions/src/resubmitDraft.ts functions/tests/resubmitDraft.test.ts functions/src/index.ts
git commit -m "feat: implement resubmitDraft Cloud Function with tests"
```

---

### Task 10: deleteAccount Cloud Function

**Files:**
- Create: `functions/src/deleteAccount.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Implement deleteAccount.ts**

(This is a trivial Firebase trigger — the test would just verify `recursiveDelete` is called, which is pure mock verification with no real logic to test. Implementation is 5 lines.)

Create `functions/src/deleteAccount.ts`:
```typescript
import { user } from 'firebase-functions/v1/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const deleteAccount = user().onDelete(async (userRecord) => {
  const db = getFirestore();
  const userDocRef = db.doc(`users/${userRecord.uid}`);
  await db.recursiveDelete(userDocRef);
});
```

- [ ] **Step 2: Add export to index.ts**

Add: `export { deleteAccount } from './deleteAccount';`

- [ ] **Step 3: Verify functions compile**

Run:
```bash
cd /home/ssilver/development/essay-grader/functions && npm run build && cd /home/ssilver/development/essay-grader
```

- [ ] **Step 4: Commit**

```bash
git add functions/src/deleteAccount.ts functions/src/index.ts
git commit -m "feat: implement deleteAccount auth trigger"
```

---

## Chunk 3: Frontend — Auth, Layout & Home (TDD)

### Task 11: Firebase Client Config & Test Utils

**Files:**
- Create: `src/firebase.ts`, `.env.example`, `src/test-utils.tsx`

- [ ] **Step 1: Create .env.example**

```
VITE_FIREBASE_API_KEY=
VITE_FIREBASE_AUTH_DOMAIN=
VITE_FIREBASE_PROJECT_ID=
VITE_FIREBASE_STORAGE_BUCKET=
VITE_FIREBASE_MESSAGING_SENDER_ID=
VITE_FIREBASE_APP_ID=
```

- [ ] **Step 2: Implement firebase.ts**

Create `src/firebase.ts`:
```typescript
import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getFunctions } from 'firebase/functions';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const functions = getFunctions(app);
```

- [ ] **Step 3: Create test utilities**

Create `src/test-utils.tsx`:
```typescript
import { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';

// Mock auth context values
export const mockAuthValue = {
  user: { uid: 'test-uid', email: 'test@gmail.com', displayName: 'Test', photoURL: null } as any,
  loading: false,
  allowed: true,
  signIn: vi.fn(),
  logOut: vi.fn(),
};

// Mock the useAuth hook globally for component tests
vi.mock('./hooks/useAuth', () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock firebase client SDK
vi.mock('./firebase', () => ({
  auth: {},
  googleProvider: {},
  db: {},
  functions: {},
}));

interface WrapperOptions {
  route?: string;
}

export function renderWithRouter(
  ui: ReactNode,
  { route = '/', ...options }: WrapperOptions & RenderOptions = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
    ),
    ...options,
  });
}
```

- [ ] **Step 4: Add .env.local to .gitignore**

- [ ] **Step 5: Commit**

```bash
git add src/firebase.ts src/test-utils.tsx .env.example .gitignore
git commit -m "feat: add Firebase client config and test utilities"
```

---

### Task 12: Auth Hook & Login Page

**Files:**
- Create: `src/hooks/useAuth.tsx`, `src/pages/LoginPage.tsx`, `src/pages/LoginPage.test.tsx`

- [ ] **Step 1: Write failing LoginPage test**

Create `src/pages/LoginPage.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Override mock for LoginPage-specific tests
const mockSignIn = vi.fn();
const mockLogOut = vi.fn();
let mockAuthState = {
  user: null as any,
  loading: false,
  allowed: null as boolean | null,
  signIn: mockSignIn,
  logOut: mockLogOut,
};

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

import LoginPage from './LoginPage';

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      user: null,
      loading: false,
      allowed: null,
      signIn: mockSignIn,
      logOut: mockLogOut,
    };
  });

  it('shows loading state when auth is loading', () => {
    mockAuthState.loading = true;
    renderLogin();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows Google sign-in button when not signed in', () => {
    renderLogin();
    expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
  });

  it('calls signIn when Google button is clicked', async () => {
    renderLogin();
    await userEvent.click(screen.getByText(/sign in with google/i));
    expect(mockSignIn).toHaveBeenCalled();
  });

  it('shows access denied when user is signed in but not allowed', () => {
    mockAuthState.user = { uid: 'u1', email: 'bad@gmail.com' };
    mockAuthState.allowed = false;
    renderLogin();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it('shows sign out button on access denied', () => {
    mockAuthState.user = { uid: 'u1', email: 'bad@gmail.com' };
    mockAuthState.allowed = false;
    renderLogin();
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement useAuth hook**

Create `src/hooks/useAuth.tsx`:
```typescript
import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, googleProvider, db } from '../firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  allowed: boolean | null;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const allowlistDoc = await getDoc(doc(db, 'config', 'allowlist'));
        const emails: string[] = allowlistDoc.data()?.emails ?? [];
        const isAllowed = emails.includes(firebaseUser.email?.toLowerCase() ?? '');
        setAllowed(isAllowed);

        if (isAllowed) {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            await setDoc(userDocRef, {
              displayName: firebaseUser.displayName ?? '',
              email: firebaseUser.email ?? '',
              createdAt: serverTimestamp(),
            });
          }
        }
      } else {
        setAllowed(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => { await signInWithPopup(auth, googleProvider); };
  const logOut = async () => { await signOut(auth); setAllowed(null); };

  return (
    <AuthContext.Provider value={{ user, loading, allowed, signIn, logOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
```

- [ ] **Step 4: Implement LoginPage**

Create `src/pages/LoginPage.tsx`:
```typescript
import { useAuth } from '../hooks/useAuth';
import { Navigate } from 'react-router-dom';

export default function LoginPage() {
  const { user, loading, allowed, signIn, logOut } = useAuth();

  if (loading) return <div className="center">Loading...</div>;
  if (user && allowed) return <Navigate to="/" />;

  return (
    <div className="login-page">
      <h1>EssayCoach</h1>
      <p>Get feedback on your writing and improve through revision.</p>
      {user && allowed === false ? (
        <div className="access-denied">
          <p>You don't have access yet. Contact the administrator.</p>
          <button onClick={logOut}>Sign out</button>
        </div>
      ) : (
        <button className="google-sign-in" onClick={signIn}>
          Sign in with Google
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 6: Commit**

```bash
git add src/hooks/useAuth.tsx src/pages/LoginPage.tsx src/pages/LoginPage.test.tsx
git commit -m "feat: add auth with Google sign-in, allowlist check, and LoginPage with tests"
```

---

### Task 13: Layout, ProtectedRoute & Routing

**Files:**
- Create: `src/components/Layout.tsx`, `src/components/Layout.test.tsx`
- Create: `src/components/ProtectedRoute.tsx`, `src/components/ProtectedRoute.test.tsx`
- Modify: `src/App.tsx`, `src/main.tsx`

- [ ] **Step 1: Write failing Layout test**

Create `src/components/Layout.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import Layout from './Layout';

describe('Layout', () => {
  it('renders the brand name', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('EssayCoach')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('New Essay')).toBeInTheDocument();
    expect(screen.getByText('My Essays')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Write failing ProtectedRoute test**

Create `src/components/ProtectedRoute.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let mockAuth = { user: null as any, loading: false, allowed: null as boolean | null, signIn: vi.fn(), logOut: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockAuth }));

import ProtectedRoute from './ProtectedRoute';

describe('ProtectedRoute', () => {
  it('shows loading when auth is loading', () => {
    mockAuth = { ...mockAuth, loading: true };
    render(
      <MemoryRouter>
        <ProtectedRoute><div>Protected</div></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    mockAuth = { ...mockAuth, user: null, loading: false, allowed: null };
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/protected" element={<ProtectedRoute><div>Protected</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('renders children when authenticated and allowed', () => {
    mockAuth = { ...mockAuth, user: { uid: 'u1' }, loading: false, allowed: true };
    render(
      <MemoryRouter>
        <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement Layout**

Create `src/components/Layout.tsx`:
```typescript
import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Layout() {
  const { user, logOut } = useAuth();

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-content">
          <div className="nav-brand">EssayCoach</div>
          <div className="nav-links">
            <NavLink to="/new">New Essay</NavLink>
            <NavLink to="/">My Essays</NavLink>
            <NavLink to="/progress">Progress</NavLink>
          </div>
          <div className="nav-user">
            {user?.photoURL && <img src={user.photoURL} alt="" className="avatar" />}
            <button onClick={logOut} className="sign-out-btn">Sign out</button>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 5: Implement ProtectedRoute**

Create `src/components/ProtectedRoute.tsx`:
```typescript
import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, allowed } = useAuth();
  if (loading) return <div className="center">Loading...</div>;
  if (!user || !allowed) return <Navigate to="/login" />;
  return <>{children}</>;
}
```

- [ ] **Step 6: Set up App.tsx, main.tsx, placeholder pages, and CSS**

Create `src/App.tsx` with full routing, `src/main.tsx` with AuthProvider, placeholder page stubs for HomePage/NewEssayPage/EssayPage/RevisionPage/ProgressPage (each returns `<div>PageName — coming soon</div>`), and `src/index.css` with full styles.

(CSS and placeholder content is identical to the original plan — see Chunk 3 Task 12 in prior version for the full CSS.)

- [ ] **Step 7: Run tests to verify they pass**

Run: `npm test`
Expected: All PASS.

- [ ] **Step 8: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/components/Layout.tsx src/components/Layout.test.tsx src/components/ProtectedRoute.tsx src/components/ProtectedRoute.test.tsx src/App.tsx src/main.tsx src/pages/ src/index.css .env.example
git commit -m "feat: add layout, routing, protected routes with tests"
```

---

## Chunk 4: Frontend Components (TDD)

### Task 14: TraitCard Component

**Files:**
- Create: `src/components/TraitCard.tsx`, `src/components/TraitCard.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/TraitCard.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import TraitCard from './TraitCard';
import type { TraitEvaluation } from '../types';

const mockEval: TraitEvaluation = {
  score: 2,
  feedback: 'Multiple run-on sentences need fixing.',
  revisionPriority: 1,
  annotations: [
    { quotedText: 'Hamlet is a play about things', comment: 'Too vague' },
  ],
};

describe('TraitCard', () => {
  it('renders trait name and score', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.getByText('Conventions')).toBeInTheDocument();
    expect(screen.getByText('2/6')).toBeInTheDocument();
  });

  it('renders feedback text', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.getByText(/run-on sentences/)).toBeInTheDocument();
  });

  it('applies score-low class for scores 1-2', () => {
    const { container } = renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(container.querySelector('.score-low')).toBeInTheDocument();
  });

  it('applies score-high class for scores 4+', () => {
    const highEval = { ...mockEval, score: 5 };
    const { container } = renderWithRouter(
      <TraitCard traitKey="voice" evaluation={highEval} expanded={false} onClick={vi.fn()} />
    );
    expect(container.querySelector('.score-high')).toBeInTheDocument();
  });

  it('shows annotations when expanded', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={true} onClick={vi.fn()} />
    );
    expect(screen.getByText(/too vague/i)).toBeInTheDocument();
  });

  it('hides annotations when collapsed', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.queryByText(/too vague/i)).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={onClick} />
    );
    await userEvent.click(screen.getByText('Conventions'));
    expect(onClick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement TraitCard**

Create `src/components/TraitCard.tsx`:
```typescript
import { TRAIT_LABELS, type TraitKey, type TraitEvaluation } from '../types';
import { scoreClass, scoreColor } from '../utils';

interface Props {
  traitKey: TraitKey;
  evaluation: TraitEvaluation;
  expanded: boolean;
  onClick: () => void;
}

export default function TraitCard({ traitKey, evaluation, expanded, onClick }: Props) {
  return (
    <div className={`trait-card ${scoreClass(evaluation.score)}`} onClick={onClick}>
      <div className="trait-card-header">
        <span className="trait-card-name">{TRAIT_LABELS[traitKey]}</span>
        <span className="trait-card-score" style={{ color: scoreColor(evaluation.score) }}>
          {evaluation.score}/6
        </span>
      </div>
      <p className="trait-card-feedback">{evaluation.feedback}</p>
      {expanded && evaluation.annotations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {evaluation.annotations.map((ann, i) => (
            <div key={i} className="annotation">
              <div className="annotation-quote">"{ann.quotedText}"</div>
              <div className="annotation-comment">{ann.comment}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/TraitCard.tsx src/components/TraitCard.test.tsx
git commit -m "feat: implement TraitCard component with tests"
```

---

### Task 15: RevisionPlanBanner, DraftSelector, ScoreDelta

**Files:**
- Create all 3 components + 3 test files

- [ ] **Step 1: Write failing tests for all three**

Create `src/components/RevisionPlanBanner.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import RevisionPlanBanner from './RevisionPlanBanner';

describe('RevisionPlanBanner', () => {
  it('renders nothing when revision plan is empty', () => {
    const { container } = renderWithRouter(<RevisionPlanBanner revisionPlan={[]} />);
    expect(container.querySelector('.revision-banner')).not.toBeInTheDocument();
  });

  it('renders all revision steps', () => {
    renderWithRouter(<RevisionPlanBanner revisionPlan={['Fix conventions', 'Improve organization']} />);
    expect(screen.getByText(/fix conventions/i)).toBeInTheDocument();
    expect(screen.getByText(/improve organization/i)).toBeInTheDocument();
  });

  it('highlights the first step as active', () => {
    const { container } = renderWithRouter(
      <RevisionPlanBanner revisionPlan={['First step', 'Second step']} />
    );
    const steps = container.querySelectorAll('.revision-step');
    expect(steps[0]).toHaveClass('active');
    expect(steps[1]).not.toHaveClass('active');
  });
});
```

Create `src/components/DraftSelector.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import DraftSelector from './DraftSelector';
import type { Draft } from '../types';

const drafts: Draft[] = [
  { id: 'd2', draftNumber: 2, content: '', submittedAt: new Date('2026-03-13'), evaluation: null, revisionStage: null },
  { id: 'd1', draftNumber: 1, content: '', submittedAt: new Date('2026-03-12'), evaluation: null, revisionStage: null },
];

describe('DraftSelector', () => {
  it('renders nothing when only one draft', () => {
    const { container } = renderWithRouter(
      <DraftSelector drafts={[drafts[0]]} selectedDraftId="d2" onChange={vi.fn()} />
    );
    expect(container.querySelector('select')).not.toBeInTheDocument();
  });

  it('renders dropdown with draft options', () => {
    renderWithRouter(
      <DraftSelector drafts={drafts} selectedDraftId="d2" onChange={vi.fn()} />
    );
    expect(screen.getByText(/Draft 2/)).toBeInTheDocument();
    expect(screen.getByText(/Draft 1/)).toBeInTheDocument();
  });

  it('calls onChange when selection changes', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <DraftSelector drafts={drafts} selectedDraftId="d2" onChange={onChange} />
    );
    await userEvent.selectOptions(screen.getByRole('combobox'), 'd1');
    expect(onChange).toHaveBeenCalledWith('d1');
  });
});
```

Create `src/components/ScoreDelta.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import ScoreDelta from './ScoreDelta';

describe('ScoreDelta', () => {
  it('shows positive change with up arrow', () => {
    renderWithRouter(<ScoreDelta previous={2} current={4} />);
    const el = screen.getByText(/2 → 4/);
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('positive');
  });

  it('shows negative change with down arrow', () => {
    renderWithRouter(<ScoreDelta previous={4} current={3} />);
    const el = screen.getByText(/4 → 3/);
    expect(el).toHaveClass('negative');
  });

  it('shows neutral when no change', () => {
    renderWithRouter(<ScoreDelta previous={3} current={3} />);
    const el = screen.getByText(/3 → 3/);
    expect(el).toHaveClass('neutral');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

- [ ] **Step 3: Implement all three components**

Create `src/components/RevisionPlanBanner.tsx`:
```typescript
interface Props { revisionPlan: string[]; }

export default function RevisionPlanBanner({ revisionPlan }: Props) {
  if (revisionPlan.length === 0) return null;
  return (
    <div className="revision-banner">
      <h3>Your Revision Plan</h3>
      <div className="revision-steps">
        {revisionPlan.map((step, i) => (
          <span key={i} className={`revision-step ${i === 0 ? 'active' : ''}`}>
            {i + 1}. {step}
          </span>
        ))}
      </div>
    </div>
  );
}
```

Create `src/components/DraftSelector.tsx`:
```typescript
import type { Draft } from '../types';

interface Props { drafts: Draft[]; selectedDraftId: string; onChange: (id: string) => void; }

export default function DraftSelector({ drafts, selectedDraftId, onChange }: Props) {
  if (drafts.length <= 1) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 14, fontWeight: 500, marginRight: 8 }}>Draft:</label>
      <select value={selectedDraftId} onChange={(e) => onChange(e.target.value)}
        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
        {drafts.map((d) => (
          <option key={d.id} value={d.id}>
            Draft {d.draftNumber} — {d.submittedAt.toLocaleDateString()}
          </option>
        ))}
      </select>
    </div>
  );
}
```

Create `src/components/ScoreDelta.tsx`:
```typescript
interface Props { previous: number; current: number; }

export default function ScoreDelta({ previous, current }: Props) {
  const delta = current - previous;
  const className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '';
  return <span className={`score-delta ${className}`}>{previous} → {current} {arrow}</span>;
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/RevisionPlanBanner.tsx src/components/RevisionPlanBanner.test.tsx src/components/DraftSelector.tsx src/components/DraftSelector.test.tsx src/components/ScoreDelta.tsx src/components/ScoreDelta.test.tsx
git commit -m "feat: implement RevisionPlanBanner, DraftSelector, ScoreDelta with tests"
```

---

### Task 16: AnnotatedEssay Component

**Files:**
- Create: `src/components/AnnotatedEssay.tsx`, `src/components/AnnotatedEssay.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/components/AnnotatedEssay.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import AnnotatedEssay from './AnnotatedEssay';

describe('AnnotatedEssay', () => {
  it('renders essay content in a textarea when editable', () => {
    renderWithRouter(
      <AnnotatedEssay content="My essay text" annotations={[]} onChange={vi.fn()} />
    );
    expect(screen.getByDisplayValue('My essay text')).toBeInTheDocument();
  });

  it('calls onChange when text is edited', async () => {
    const onChange = vi.fn();
    renderWithRouter(
      <AnnotatedEssay content="" annotations={[]} onChange={onChange} />
    );
    const textarea = screen.getByRole('textbox');
    await userEvent.type(textarea, 'Hello');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders highlighted passages in read-only mode', () => {
    const { container } = renderWithRouter(
      <AnnotatedEssay
        content="This is a good play about things and stuff."
        annotations={[{ quotedText: 'good play about things', comment: 'Too vague' }]}
        onChange={vi.fn()}
        readOnly
      />
    );
    const mark = container.querySelector('mark');
    expect(mark).toBeInTheDocument();
    expect(mark?.textContent).toContain('good play about things');
  });

  it('gracefully handles missing quoted text', () => {
    const { container } = renderWithRouter(
      <AnnotatedEssay
        content="This is my essay."
        annotations={[{ quotedText: 'nonexistent passage', comment: 'Comment' }]}
        onChange={vi.fn()}
        readOnly
      />
    );
    const mark = container.querySelector('mark');
    expect(mark).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement AnnotatedEssay**

Create `src/components/AnnotatedEssay.tsx`:
```typescript
import { useMemo } from 'react';
import type { Annotation } from '../types';

interface Props {
  content: string;
  annotations: Annotation[];
  onChange: (content: string) => void;
  readOnly?: boolean;
}

export default function AnnotatedEssay({ content, annotations, onChange, readOnly }: Props) {
  const highlightedHtml = useMemo(() => {
    if (annotations.length === 0) return escapeHtml(content);
    let html = escapeHtml(content);
    const sorted = [...annotations].sort((a, b) => b.quotedText.length - a.quotedText.length);
    for (const ann of sorted) {
      const escaped = escapeHtml(ann.quotedText);
      const idx = html.indexOf(escaped);
      if (idx !== -1) {
        html = html.slice(0, idx) +
          `<mark title="${escapeAttr(ann.comment)}">${escaped}</mark>` +
          html.slice(idx + escaped.length);
      }
    }
    return html.replace(/\n/g, '<br/>');
  }, [content, annotations]);

  if (readOnly) {
    return (
      <div className="essay-preview" style={{ padding: 16, lineHeight: 1.8, fontSize: 14 }}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
    );
  }

  return (
    <div>
      <textarea className="essay-editor" value={content} onChange={(e) => onChange(e.target.value)} />
      {annotations.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            Show highlighted passages
          </summary>
          <div style={{ padding: 16, background: 'var(--color-surface)', borderRadius: 6, marginTop: 8, lineHeight: 1.8, fontSize: 14 }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        </details>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/components/AnnotatedEssay.tsx src/components/AnnotatedEssay.test.tsx
git commit -m "feat: implement AnnotatedEssay with quoted-text highlighting and tests"
```

---

## Chunk 5: Frontend Pages (TDD), Hooks & Deploy

### Task 17: Data Hooks

**Files:**
- Create: `src/hooks/useEssays.ts`, `src/hooks/useEssay.ts`

- [ ] **Step 1: Implement hooks**

(These hooks wrap Firestore `onSnapshot` — testing them requires mocking the entire Firestore real-time SDK, which produces brittle tests. Instead, they'll be tested indirectly through the page component tests in Tasks 18-21.)

Create `src/hooks/useEssays.ts`:
```typescript
import { useState, useEffect } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import type { Essay } from '../types';

export function useEssays() {
  const { user } = useAuth();
  const [essays, setEssays] = useState<Essay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/essays`), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const result: Essay[] = snapshot.docs.map((doc) => ({
        id: doc.id, ...doc.data(),
        createdAt: doc.data().createdAt?.toDate() ?? new Date(),
        updatedAt: doc.data().updatedAt?.toDate() ?? new Date(),
      })) as Essay[];
      setEssays(result);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  return { essays, loading };
}
```

Create `src/hooks/useEssay.ts`:
```typescript
import { useState, useEffect } from 'react';
import { doc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import type { Essay, Draft } from '../types';

export function useEssay(essayId: string | undefined) {
  const { user } = useAuth();
  const [essay, setEssay] = useState<Essay | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !essayId) return;
    const essayRef = doc(db, `users/${user.uid}/essays/${essayId}`);
    const unsubEssay = onSnapshot(essayRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setEssay({ id: snapshot.id, ...data,
          createdAt: data.createdAt?.toDate() ?? new Date(),
          updatedAt: data.updatedAt?.toDate() ?? new Date(),
        } as Essay);
      }
    });
    const draftsQuery = query(
      collection(db, `users/${user.uid}/essays/${essayId}/drafts`),
      orderBy('draftNumber', 'desc')
    );
    const unsubDrafts = onSnapshot(draftsQuery, (snapshot) => {
      const result: Draft[] = snapshot.docs.map((d) => ({
        id: d.id, ...d.data(), submittedAt: d.data().submittedAt?.toDate() ?? new Date(),
      })) as Draft[];
      setDrafts(result);
      setLoading(false);
    });
    return () => { unsubEssay(); unsubDrafts(); };
  }, [user, essayId]);

  return { essay, drafts, loading };
}
```

- [ ] **Step 2: Commit**

```bash
git add src/hooks/useEssays.ts src/hooks/useEssay.ts
git commit -m "feat: add Firestore data hooks for essays and drafts"
```

---

### Task 18: HomePage

**Files:**
- Modify: `src/pages/HomePage.tsx`
- Create: `src/pages/HomePage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/pages/HomePage.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';

let mockEssaysState = { essays: [] as any[], loading: false };
vi.mock('../hooks/useEssays', () => ({
  useEssays: () => mockEssaysState,
}));

import HomePage from './HomePage';

describe('HomePage', () => {
  it('shows loading spinner when loading', () => {
    mockEssaysState = { essays: [], loading: true };
    renderWithRouter(<HomePage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no essays', () => {
    mockEssaysState = { essays: [], loading: false };
    renderWithRouter(<HomePage />);
    expect(screen.getByText(/welcome/i)).toBeInTheDocument();
    expect(screen.getByText(/first essay/i)).toBeInTheDocument();
  });

  it('shows essay list when essays exist', () => {
    mockEssaysState = {
      essays: [
        { id: 'e1', title: 'Hamlet Analysis', writingType: 'analytical', currentDraftNumber: 2, updatedAt: new Date('2026-03-13'), createdAt: new Date() },
      ],
      loading: false,
    };
    renderWithRouter(<HomePage />);
    expect(screen.getByText('Hamlet Analysis')).toBeInTheDocument();
    expect(screen.getByText(/draft 2/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement HomePage**

Replace `src/pages/HomePage.tsx`:
```typescript
import { Link } from 'react-router-dom';
import { useEssays } from '../hooks/useEssays';

export default function HomePage() {
  const { essays, loading } = useEssays();

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essays...</p></div>;

  if (essays.length === 0) {
    return (
      <div className="empty-state">
        <h2>Welcome to EssayCoach</h2>
        <p>Submit your first essay to get feedback and start improving your writing.</p>
        <Link to="/new" className="btn-primary">Write Your First Essay</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>My Essays</h2>
        <Link to="/new" className="btn-primary">New Essay</Link>
      </div>
      <ul className="essay-list">
        {essays.map((essay) => (
          <Link key={essay.id} to={`/essay/${essay.id}`} className="essay-list-item">
            <div>
              <strong>{essay.title}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {essay.writingType} · Draft {essay.currentDraftNumber}
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {essay.updatedAt.toLocaleDateString()}
            </div>
          </Link>
        ))}
      </ul>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/HomePage.tsx src/pages/HomePage.test.tsx
git commit -m "feat: implement HomePage with essay list and empty state, with tests"
```

---

### Task 19: NewEssayPage

**Files:**
- Modify: `src/pages/NewEssayPage.tsx`
- Create: `src/pages/NewEssayPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/pages/NewEssayPage.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn().mockResolvedValue({ data: { essayId: 'new1' } }),
}));

import NewEssayPage from './NewEssayPage';

describe('NewEssayPage', () => {
  it('renders all form fields', () => {
    renderWithRouter(<NewEssayPage />);
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/writing type/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/assignment prompt/i)).toBeInTheDocument();
    expect(screen.getByLabelText(/your essay/i)).toBeInTheDocument();
  });

  it('shows word count', async () => {
    renderWithRouter(<NewEssayPage />);
    const textarea = screen.getByLabelText(/your essay/i);
    await userEvent.type(textarea, 'one two three four five');
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('disables submit when fields are empty', () => {
    renderWithRouter(<NewEssayPage />);
    const submitBtn = screen.getByRole('button', { name: /submit/i });
    expect(submitBtn).toBeDisabled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement NewEssayPage**

Replace `src/pages/NewEssayPage.tsx`:
```typescript
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { WRITING_TYPES, type WritingType } from '../types';
import { countWords } from '../utils';

export default function NewEssayPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = countWords(content);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const submitEssay = httpsCallable(functions, 'submitEssay');
      const result = await submitEssay({ title, assignmentPrompt, writingType, content });
      const { essayId } = result.data as { essayId: string };
      navigate(`/essay/${essayId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to submit essay. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>New Essay</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <div className="form-group">
          <label htmlFor="title">Title</label>
          <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            maxLength={200} required placeholder="e.g., Hamlet Analysis" />
        </div>
        <div className="form-group">
          <label htmlFor="writingType">Writing Type</label>
          <select id="writingType" value={writingType} onChange={(e) => setWritingType(e.target.value as WritingType)}>
            {WRITING_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="prompt">Assignment Prompt</label>
          <textarea id="prompt" value={assignmentPrompt} onChange={(e) => setAssignmentPrompt(e.target.value)}
            maxLength={2000} required placeholder="Paste the assignment prompt here..." rows={3} />
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>{assignmentPrompt.length}/2,000 characters</div>
        </div>
        <div className="form-group">
          <label htmlFor="essay">Your Essay</label>
          <textarea id="essay" value={content} onChange={(e) => setContent(e.target.value)}
            required placeholder="Paste or type your essay here..." rows={16} />
          <div style={{ fontSize: 12, color: wordCount > 10000 ? 'var(--color-red)' : 'var(--color-text-secondary)', marginTop: 4 }}>
            {wordCount.toLocaleString()} / 10,000 words
          </div>
        </div>
        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}
        {submitting ? (
          <div className="loading-state"><div className="spinner" /><p>Evaluating your essay... This may take 10-30 seconds.</p></div>
        ) : (
          <button type="submit" className="btn-primary" disabled={!title || !assignmentPrompt || !content || wordCount > 10000}>
            Submit for Feedback
          </button>
        )}
      </form>
    </div>
  );
}
```

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/NewEssayPage.tsx src/pages/NewEssayPage.test.tsx
git commit -m "feat: implement NewEssayPage with form validation, word count, and tests"
```

---

### Task 20: EssayPage (Trait Grid)

**Files:**
- Modify: `src/pages/EssayPage.tsx`
- Create: `src/pages/EssayPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/pages/EssayPage.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import type { Evaluation, TraitEvaluation } from '../types';

const makeTrait = (score: number, priority: number | null): TraitEvaluation => ({
  score, feedback: `Feedback for score ${score}`, revisionPriority: priority,
  annotations: [{ quotedText: 'sample', comment: 'comment' }],
});

const mockEval: Evaluation = {
  traits: {
    ideas: makeTrait(4, null), organization: makeTrait(3, 2), voice: makeTrait(5, null),
    wordChoice: makeTrait(3, 3), sentenceFluency: makeTrait(4, null),
    conventions: makeTrait(2, 1), presentation: makeTrait(4, null),
  },
  overallFeedback: 'Overall feedback text',
  revisionPlan: ['Fix conventions', 'Improve organization'],
  comparisonToPrevious: null,
};

let mockEssayState = {
  essay: { id: 'e1', title: 'Test Essay', writingType: 'argumentative', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
  drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay text', submittedAt: new Date(), evaluation: mockEval, revisionStage: null }],
  loading: false,
};

vi.mock('../hooks/useEssay', () => ({
  useEssay: () => mockEssayState,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ essayId: 'e1' }) };
});

import EssayPage from './EssayPage';

describe('EssayPage', () => {
  it('renders essay title', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Test Essay')).toBeInTheDocument();
  });

  it('renders all 7 trait cards', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Ideas')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Word Choice')).toBeInTheDocument();
    expect(screen.getByText('Sentence Fluency')).toBeInTheDocument();
    expect(screen.getByText('Conventions')).toBeInTheDocument();
    expect(screen.getByText('Presentation')).toBeInTheDocument();
  });

  it('renders revision plan banner', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/fix conventions/i)).toBeInTheDocument();
  });

  it('renders overall feedback', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Overall feedback text')).toBeInTheDocument();
  });

  it('renders Start Revising button for latest draft', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/start revising/i)).toBeInTheDocument();
  });

  it('shows error state when evaluation is null', () => {
    mockEssayState = {
      ...mockEssayState,
      drafts: [{ ...mockEssayState.drafts[0], evaluation: null }],
    };
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/failed|retry/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement EssayPage**

Replace `src/pages/EssayPage.tsx` with the full Trait Grid implementation (same as original plan Task 16 — renders RevisionPlanBanner, TraitCard grid, DraftSelector, comparison overlay, Start Revising link, and retry button for failed evaluations with 3-retry budget).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/EssayPage.tsx src/pages/EssayPage.test.tsx
git commit -m "feat: implement EssayPage Trait Grid with tests"
```

---

### Task 21: RevisionPage

**Files:**
- Modify: `src/pages/RevisionPage.tsx`
- Create: `src/pages/RevisionPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/pages/RevisionPage.test.tsx`:
```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import type { Evaluation, TraitEvaluation } from '../types';

const makeTrait = (score: number, priority: number | null): TraitEvaluation => ({
  score, feedback: `Feedback ${score}`, revisionPriority: priority,
  annotations: [{ quotedText: 'quoted passage', comment: 'fix this' }],
});

const mockEval: Evaluation = {
  traits: {
    ideas: makeTrait(4, null), organization: makeTrait(3, 2), voice: makeTrait(5, null),
    wordChoice: makeTrait(3, 3), sentenceFluency: makeTrait(4, null),
    conventions: makeTrait(2, 1), presentation: makeTrait(4, null),
  },
  overallFeedback: 'Overall', revisionPlan: ['Fix conventions'], comparisonToPrevious: null,
};

vi.mock('../hooks/useEssay', () => ({
  useEssay: () => ({
    essay: { id: 'e1', title: 'Test Essay', writingType: 'analytical', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
    drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay content with quoted passage here.', submittedAt: new Date(), evaluation: mockEval, revisionStage: null }],
    loading: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ essayId: 'e1' }), useNavigate: () => vi.fn(), useBlocker: vi.fn() };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn().mockResolvedValue({ data: {} }),
}));

import RevisionPage from './RevisionPage';

describe('RevisionPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the essay title with Revision', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/test essay.*revision/i)).toBeInTheDocument();
  });

  it('renders trait selector buttons', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/conventions/i)).toBeInTheDocument();
    expect(screen.getByText(/organization/i)).toBeInTheDocument();
  });

  it('renders the essay text in a textarea', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByDisplayValue(/essay content/i)).toBeInTheDocument();
  });

  it('renders feedback panel', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/fix this/i)).toBeInTheDocument();
  });

  it('renders Resubmit button', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/resubmit/i)).toBeInTheDocument();
  });

  it('saves to localStorage on edit (autosave)', async () => {
    renderWithRouter(<RevisionPage />);
    const textarea = screen.getByDisplayValue(/essay content/i);
    await userEvent.type(textarea, ' new text');
    expect(localStorage.getItem('essaycoach_autosave_e1')).toContain('new text');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement RevisionPage**

Replace `src/pages/RevisionPage.tsx` with the full side-by-side revision implementation (same as original plan Task 17 — textarea editor, trait selector, feedback panel, resubmit with 3-retry budget, localStorage autosave, unsaved changes warning).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/RevisionPage.tsx src/pages/RevisionPage.test.tsx
git commit -m "feat: implement RevisionPage with autosave and tests"
```

---

### Task 22: ProgressPage

**Files:**
- Modify: `src/pages/ProgressPage.tsx`
- Create: `src/pages/ProgressPage.test.tsx`

- [ ] **Step 1: Write failing test**

Create `src/pages/ProgressPage.test.tsx`:
```typescript
import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';

vi.mock('../hooks/useEssays', () => ({
  useEssays: () => ({ essays: [], loading: false }),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), serverTimestamp: vi.fn(),
  onSnapshot: vi.fn(),
}));

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

import ProgressPage from './ProgressPage';

describe('ProgressPage', () => {
  it('shows empty state when no data', async () => {
    renderWithRouter(<ProgressPage />);
    expect(await screen.findByText(/no progress data/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement ProgressPage**

Replace `src/pages/ProgressPage.tsx` with the chart implementation (same as original plan Task 18 — fetches all drafts, builds data points, renders LineChart per trait).

- [ ] **Step 4: Run tests to verify they pass**

- [ ] **Step 5: Commit**

```bash
git add src/pages/ProgressPage.tsx src/pages/ProgressPage.test.tsx
git commit -m "feat: implement ProgressPage with trait charts and tests"
```

---

### Task 23: Seed Allowlist & Deploy Config

**Files:**
- Create: `scripts/seed-allowlist.ts`
- Modify: `firebase.json`

- [ ] **Step 1: Create seed script**

Create `scripts/seed-allowlist.ts`:
```typescript
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function seed() {
  await db.doc('config/allowlist').set({
    emails: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
  });
  console.log('Allowlist seeded successfully.');
}

seed().catch(console.error);
```

- [ ] **Step 2: Install tsx**

Run: `npm install -D tsx`

- [ ] **Step 3: Configure firebase.json**

```json
{
  "hosting": {
    "public": "dist",
    "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
    "rewrites": [{ "source": "**", "destination": "/index.html" }]
  },
  "firestore": { "rules": "firestore.rules", "indexes": "firestore.indexes.json" },
  "functions": [{
    "source": "functions", "codebase": "default",
    "ignore": ["node_modules", ".git", "firebase-debug.log", "*.local"],
    "predeploy": ["npm --prefix \"$RESOURCE_DIR\" run build"]
  }]
}
```

- [ ] **Step 4: Run full test suite**

Run:
```bash
npm test && cd functions && npm test && cd ..
```
Expected: All tests PASS across both frontend and backend.

- [ ] **Step 5: Commit**

```bash
git add scripts/seed-allowlist.ts firebase.json package.json package-lock.json
git commit -m "chore: add allowlist seed script and Firebase deploy config"
```

---

### Task 24: Deploy

- [ ] **Step 1: Set Gemini API key as Firebase secret**

Run: `firebase functions:secrets:set GEMINI_API_KEY`

- [ ] **Step 2: Populate .env.local with Firebase config**

Get values from Firebase console.

- [ ] **Step 3: Seed the allowlist**

Run: `npx tsx scripts/seed-allowlist.ts`

- [ ] **Step 4: Deploy everything**

Run:
```bash
npm run build
firebase deploy
```

- [ ] **Step 5: Verify the deployed app**

Open the Firebase Hosting URL. Sign in with an allowlisted account. Test:
1. Google sign-in works
2. Non-allowlisted user sees access denied
3. Essay submission triggers evaluation (10-30s)
4. Trait Grid displays scores and feedback
5. Side-by-side revision view shows annotations
6. Resubmission creates new draft with comparison
7. Progress page shows charts
