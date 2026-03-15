# Grammar Analysis Tab Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Grammar" tab that analyzes essays for sentence-level mechanics errors and higher-order writing patterns, with categorized counts and inline Socratic feedback.

**Architecture:** Follows the exact Transitions tab pattern — a Firebase cloud function calls Gemini with a grammar-specific system prompt and structured JSON schema, stores the result on the draft document, and the frontend renders it in a new tab with a summary bar, category breakdown, and inline underline markers on the essay text.

**Tech Stack:** TypeScript, React, Firebase Functions v2, Gemini API (`@google/genai`), Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-grammar-analysis-tab-design.md`

---

## File Map

| Action | File | Responsibility |
|---|---|---|
| Create | `functions/src/grammar.ts` | System prompt, Gemini schema, prompt builder, `analyzeGrammarWithGemini()` |
| Create | `functions/src/analyzeGrammar.ts` | Cloud function entry point (auth, Firestore, calls grammar.ts) |
| Create | `functions/tests/grammar.test.ts` | Unit tests for grammar.ts |
| Create | `src/components/GrammarView.tsx` | React component — summary bar, category breakdown, inline markers |
| Modify | `functions/src/index.ts` | Add `export { analyzeGrammar }` |
| Modify | `src/types.ts` | Add grammar interfaces, extend Draft |
| Modify | `src/pages/EssayPage.tsx` | Add Grammar tab button + handler + view rendering |
| Modify | `src/index.css` | Grammar-specific styles |

---

## Chunk 1: Backend — grammar.ts

### Task 1: Create grammar.ts with system prompt and schema

**Files:**
- Create: `functions/src/grammar.ts`
- Reference: `functions/scripts/test-grammar.ts` (lines 211-251 for system prompt, lines 48-207 for schema)
- Reference: `functions/src/transitions.ts` (for structural pattern)

- [ ] **Step 1: Create `functions/src/grammar.ts` with exports**

Create the file with: system prompt, Gemini response schema, prompt builder, types, and the `analyzeGrammarWithGemini()` function. Adapt directly from the tested prototypes.

```typescript
// functions/src/grammar.ts
import { GoogleGenAI } from '@google/genai';
import type { DocumentReference } from 'firebase-admin/firestore';

// ── Types ────────────────────────────────────────────────────────────────

export interface GrammarIssue {
  sentence: string;
  quotedText: string;
  comment: string;
  severity: 'error' | 'warning' | 'pattern';
}

export interface GrammarIssueCategory {
  locations: GrammarIssue[];
}

export interface GrammarAnalysis {
  commaSplices: GrammarIssueCategory;
  runOnSentences: GrammarIssueCategory;
  fragments: GrammarIssueCategory;
  subjectVerbAgreement: GrammarIssueCategory;
  pronounReference: GrammarIssueCategory;
  verbTenseConsistency: GrammarIssueCategory;
  parallelStructure: GrammarIssueCategory;
  punctuationErrors: GrammarIssueCategory;
  missingCommas: GrammarIssueCategory;
  sentenceVariety: {
    avgLength: number;
    distribution: {
      simple: number;
      compound: number;
      complex: number;
      compoundComplex: number;
    };
    comment: string;
  };
  activePassiveVoice: {
    activeCount: number;
    passiveCount: number;
    passiveInstances: { quotedText: string; comment: string }[];
  };
  modifierPlacement: {
    issues: { quotedText: string; comment: string }[];
  };
  wordiness: {
    instances: { quotedText: string; comment: string }[];
  };
  summary: {
    totalErrors: number;
    errorsByCategory: {
      commaSplices: number;
      runOnSentences: number;
      fragments: number;
      subjectVerbAgreement: number;
      pronounReference: number;
      verbTenseConsistency: number;
      parallelStructure: number;
      punctuationErrors: number;
      missingCommas: number;
    };
    overallComment: string;
    strengthAreas: string[];
    priorityFixes: string[];
  };
}

// ── System Prompt ────────────────────────────────────────────────────────

const GRAMMAR_SYSTEM_PROMPT = `You are an expert English grammar and writing mechanics analyst for high school and college students. Your job is to perform a comprehensive grammar analysis of a student essay in a single pass, covering both sentence-level mechanics and higher-order writing patterns.

## Your analysis must cover:

### Sentence-level mechanics (errors)
Identify specific errors by quoting the EXACT text from the essay. Categories:
- **Comma splices**: Two independent clauses joined only by a comma
- **Run-on sentences**: Two or more independent clauses with no punctuation or conjunction between them, OR excessively long sentences that fuse multiple independent clauses
- **Fragments**: Incomplete sentences lacking a subject, verb, or complete thought
- **Subject-verb agreement**: Subject and verb don't match in number
- **Pronoun reference**: Ambiguous, vague, or incorrect pronoun antecedents
- **Verb tense consistency**: Unnecessary shifts in verb tense, including shifts BETWEEN adjacent sentences (not just within a single sentence). Check whether the essay maintains a consistent tense perspective throughout, and flag any unmotivated shifts.
- **Parallel structure**: Items in a list or comparison not in the same grammatical form
- **Punctuation errors**: Misused semicolons, apostrophes, colons, etc.
- **Missing commas**: After introductory elements, in compound sentences, around nonessential clauses, in lists

### Higher-order patterns
- **Sentence variety**: Count sentence types (simple, compound, complex, compound-complex), calculate average length, comment on variety
- **Active vs. passive voice**: Count each, identify all passive instances with quotes
- **Modifier placement**: Dangling or misplaced modifiers
- **Wordiness**: Unnecessarily wordy or redundant phrases

## Severity levels
- **error**: Definitively grammatically wrong. A teacher would mark this.
- **warning**: Likely wrong or very awkward. Most teachers would flag this.
- **pattern**: Not technically wrong, but a stylistic observation worth noting (e.g., overuse of passive voice, repetitive sentence structure).

## Grade-level calibration
- Do NOT flag intentional fragments used for rhetorical effect as errors — label them as "pattern" if noteworthy.
- Do NOT flag correctly used semicolons, em dashes, or other advanced punctuation as errors.
- Consider the grade level: high school students are expected to use complex sentences and varied punctuation.

## Feedback style
- ALWAYS quote the exact text from the essay that contains the issue
- Identify WHAT the error is clearly — do not be vague
- Then use Socratic guidance: ask a question that helps the student figure out how to fix it
- Example: "In 'The dogs runs fast,' the subject 'dogs' is plural, but the verb 'runs' is singular. What form of the verb would match a plural subject?"
- For higher-order patterns, explain what you observe and ask how the student might improve it

## Important rules
- Do NOT invent errors that aren't there. Only flag genuine issues.
- Do NOT flag correct grammar as incorrect. When in doubt, leave it out.
- Quote text EXACTLY as it appears in the essay — do not paraphrase or modify quotes.
- For the summary, count only items with severity 'error' or 'warning' toward totalErrors.
- priorityFixes should list the top 3 most important things to fix first.
- strengthAreas should highlight 2-3 things the student does well mechanically.`;

// ── Gemini Response Schema ───────────────────────────────────────────────
// Adapted from functions/scripts/test-grammar.ts GRAMMAR_ANALYSIS_SCHEMA

const ISSUE_LOCATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    sentence: { type: 'string' as const },
    quotedText: { type: 'string' as const },
    comment: { type: 'string' as const },
    severity: { type: 'string' as const, enum: ['error', 'warning', 'pattern'] },
  },
  required: ['sentence', 'quotedText', 'comment', 'severity'],
};

const ISSUE_CATEGORY_SCHEMA = {
  type: 'object' as const,
  properties: {
    locations: {
      type: 'array' as const,
      items: ISSUE_LOCATION_SCHEMA,
    },
  },
  required: ['locations'],
};

const GRAMMAR_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    commaSplices: ISSUE_CATEGORY_SCHEMA,
    runOnSentences: ISSUE_CATEGORY_SCHEMA,
    fragments: ISSUE_CATEGORY_SCHEMA,
    subjectVerbAgreement: ISSUE_CATEGORY_SCHEMA,
    pronounReference: ISSUE_CATEGORY_SCHEMA,
    verbTenseConsistency: ISSUE_CATEGORY_SCHEMA,
    parallelStructure: ISSUE_CATEGORY_SCHEMA,
    punctuationErrors: ISSUE_CATEGORY_SCHEMA,
    missingCommas: ISSUE_CATEGORY_SCHEMA,
    sentenceVariety: {
      type: 'object' as const,
      properties: {
        avgLength: { type: 'number' as const },
        distribution: {
          type: 'object' as const,
          properties: {
            simple: { type: 'number' as const },
            compound: { type: 'number' as const },
            complex: { type: 'number' as const },
            compoundComplex: { type: 'number' as const },
          },
          required: ['simple', 'compound', 'complex', 'compoundComplex'],
        },
        comment: { type: 'string' as const },
      },
      required: ['avgLength', 'distribution', 'comment'],
    },
    activePassiveVoice: {
      type: 'object' as const,
      properties: {
        activeCount: { type: 'number' as const },
        passiveCount: { type: 'number' as const },
        passiveInstances: {
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
      required: ['activeCount', 'passiveCount', 'passiveInstances'],
    },
    modifierPlacement: {
      type: 'object' as const,
      properties: {
        issues: {
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
      required: ['issues'],
    },
    wordiness: {
      type: 'object' as const,
      properties: {
        instances: {
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
      required: ['instances'],
    },
    summary: {
      type: 'object' as const,
      properties: {
        totalErrors: { type: 'number' as const },
        errorsByCategory: {
          type: 'object' as const,
          properties: {
            commaSplices: { type: 'number' as const },
            runOnSentences: { type: 'number' as const },
            fragments: { type: 'number' as const },
            subjectVerbAgreement: { type: 'number' as const },
            pronounReference: { type: 'number' as const },
            verbTenseConsistency: { type: 'number' as const },
            parallelStructure: { type: 'number' as const },
            punctuationErrors: { type: 'number' as const },
            missingCommas: { type: 'number' as const },
          },
          required: [
            'commaSplices', 'runOnSentences', 'fragments',
            'subjectVerbAgreement', 'pronounReference', 'verbTenseConsistency',
            'parallelStructure', 'punctuationErrors', 'missingCommas',
          ],
        },
        overallComment: { type: 'string' as const },
        strengthAreas: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
        priorityFixes: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
      },
      required: ['totalErrors', 'errorsByCategory', 'overallComment', 'strengthAreas', 'priorityFixes'],
    },
  },
  required: [
    'commaSplices', 'runOnSentences', 'fragments',
    'subjectVerbAgreement', 'pronounReference', 'verbTenseConsistency',
    'parallelStructure', 'punctuationErrors', 'missingCommas',
    'sentenceVariety', 'activePassiveVoice', 'modifierPlacement', 'wordiness',
    'summary',
  ],
};

// ── Prompt Builder ───────────────────────────────────────────────────────

export function buildGrammarPrompt(content: string): string {
  return `Perform a comprehensive grammar and mechanics analysis of this student essay. Identify all errors and patterns as specified.

Here is the essay:

---
${content}
---

Analyze every sentence carefully. Quote the exact text for each issue you find.`;
}

// ── Gemini Call ──────────────────────────────────────────────────────────

export async function analyzeGrammarWithGemini(
  apiKey: string,
  content: string,
  progressRef?: DocumentReference,
): Promise<GrammarAnalysis> {
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildGrammarPrompt(content);

  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: GRAMMAR_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: GRAMMAR_ANALYSIS_SCHEMA,
      thinkingConfig: { includeThoughts: true },
    },
  });

  let outputText = '';
  let stage: 'thinking' | 'generating' = 'thinking';
  let lastProgressWrite = 0;
  const PROGRESS_THROTTLE_MS = 2000;

  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.thought) {
        if (progressRef) {
          const now = Date.now();
          if (now - lastProgressWrite >= PROGRESS_THROTTLE_MS) {
            const lines = (part.text || '').trim().split('\n');
            const headline = lines[0]?.replace(/^\*+|\*+$/g, '').trim() || 'Thinking...';
            await progressRef.update({ grammarStatus: { stage: 'thinking', message: headline } });
            lastProgressWrite = now;
          }
        }
      } else {
        if (stage === 'thinking') {
          stage = 'generating';
          if (progressRef) {
            await progressRef.update({ grammarStatus: { stage: 'generating', message: 'Analyzing grammar...' } });
          }
        }
        outputText += part.text || '';
      }
    }
  }

  if (!outputText) {
    throw new Error('Gemini returned an empty response');
  }

  return JSON.parse(outputText) as GrammarAnalysis;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit src/grammar.ts`
Expected: No errors

---

### Task 2: Write unit tests for grammar.ts

**Files:**
- Create: `functions/tests/grammar.test.ts`
- Reference: `functions/tests/gemini.test.ts` (for mocking pattern)

- [ ] **Step 1: Write tests**

```typescript
// functions/tests/grammar.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGrammarPrompt } from '../src/grammar';

describe('buildGrammarPrompt', () => {
  it('wraps essay content in the prompt template', () => {
    const content = 'This is a test essay.';
    const result = buildGrammarPrompt(content);
    expect(result).toContain('This is a test essay.');
    expect(result).toContain('comprehensive grammar and mechanics analysis');
    expect(result).toContain('---');
  });

  it('preserves multiline content', () => {
    const content = 'Paragraph one.\n\nParagraph two.';
    const result = buildGrammarPrompt(content);
    expect(result).toContain('Paragraph one.\n\nParagraph two.');
  });
});

describe('analyzeGrammarWithGemini', () => {
  const mockGenerateContentStream = vi.fn();

  vi.mock('@google/genai', () => ({
    GoogleGenAI: vi.fn().mockImplementation(() => ({
      models: {
        generateContentStream: mockGenerateContentStream,
      },
    })),
  }));

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed GrammarAnalysis from Gemini response', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    const mockAnalysis = {
      commaSplices: { locations: [] },
      runOnSentences: { locations: [] },
      fragments: { locations: [] },
      subjectVerbAgreement: { locations: [] },
      pronounReference: { locations: [] },
      verbTenseConsistency: { locations: [] },
      parallelStructure: { locations: [] },
      punctuationErrors: { locations: [] },
      missingCommas: { locations: [] },
      sentenceVariety: { avgLength: 15, distribution: { simple: 3, compound: 2, complex: 1, compoundComplex: 0 }, comment: 'Good variety.' },
      activePassiveVoice: { activeCount: 5, passiveCount: 1, passiveInstances: [] },
      modifierPlacement: { issues: [] },
      wordiness: { instances: [] },
      summary: {
        totalErrors: 0,
        errorsByCategory: {
          commaSplices: 0, runOnSentences: 0, fragments: 0,
          subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0,
          parallelStructure: 0, punctuationErrors: 0, missingCommas: 0,
        },
        overallComment: 'Clean writing.',
        strengthAreas: ['Good grammar'],
        priorityFixes: [],
      },
    };

    const jsonText = JSON.stringify(mockAnalysis);
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: jsonText }] } }] };
      },
    });

    const result = await analyzeGrammarWithGemini('fake-key', 'Test essay.');
    expect(result.summary.overallComment).toBe('Clean writing.');
    expect(result.sentenceVariety.avgLength).toBe(15);
  });

  it('throws on empty Gemini response', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ thought: true, text: 'thinking...' }] } }] };
      },
    });

    await expect(analyzeGrammarWithGemini('fake-key', 'Test essay.')).rejects.toThrow('empty response');
  });

  it('throws on invalid JSON from Gemini', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'not valid json {{{' }] } }] };
      },
    });

    await expect(analyzeGrammarWithGemini('fake-key', 'Test essay.')).rejects.toThrow();
  });

  it('writes progress updates to progressRef during streaming', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    const mockAnalysis = {
      commaSplices: { locations: [] }, runOnSentences: { locations: [] },
      fragments: { locations: [] }, subjectVerbAgreement: { locations: [] },
      pronounReference: { locations: [] }, verbTenseConsistency: { locations: [] },
      parallelStructure: { locations: [] }, punctuationErrors: { locations: [] },
      missingCommas: { locations: [] },
      sentenceVariety: { avgLength: 10, distribution: { simple: 1, compound: 0, complex: 0, compoundComplex: 0 }, comment: 'OK' },
      activePassiveVoice: { activeCount: 1, passiveCount: 0, passiveInstances: [] },
      modifierPlacement: { issues: [] }, wordiness: { instances: [] },
      summary: { totalErrors: 0, errorsByCategory: { commaSplices: 0, runOnSentences: 0, fragments: 0, subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0, parallelStructure: 0, punctuationErrors: 0, missingCommas: 0 }, overallComment: 'Clean.', strengthAreas: [], priorityFixes: [] },
    };

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ thought: true, text: 'Analyzing grammar...' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: JSON.stringify(mockAnalysis) }] } }] };
      },
    });

    const mockRef = { update: vi.fn().mockResolvedValue(undefined) } as any;
    await analyzeGrammarWithGemini('fake-key', 'Test essay.', mockRef);
    expect(mockRef.update).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /home/ssilver/development/essay-grader/functions && npx vitest run tests/grammar.test.ts`
Expected: All tests pass

- [ ] **Step 3: Commit**

```bash
git add functions/src/grammar.ts functions/tests/grammar.test.ts
git commit -m "feat: add grammar analysis module with system prompt, schema, and tests"
```

---

## Chunk 2: Backend — Cloud Function

### Task 3: Create analyzeGrammar cloud function

**Files:**
- Create: `functions/src/analyzeGrammar.ts`
- Modify: `functions/src/index.ts`
- Reference: `functions/src/analyzeTransitions.ts` (copy-adapt)

- [ ] **Step 1: Create `functions/src/analyzeGrammar.ts`**

Copy `functions/src/analyzeTransitions.ts` and replace all transition references with grammar references:

```typescript
// functions/src/analyzeGrammar.ts
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { analyzeGrammarWithGemini } from './grammar';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const analyzeGrammar = onCall(
  { timeoutSeconds: 180, secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }

    const { essayId, draftId } = request.data;
    if (!essayId || !draftId) {
      throw new HttpsError('invalid-argument', 'essayId and draftId are required');
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    const draftRef = db.doc(`users/${uid}/essays/${essayId}/drafts/${draftId}`);
    const draftDoc = await draftRef.get();

    if (!draftDoc.exists) {
      throw new HttpsError('not-found', 'Draft not found');
    }

    const content = draftDoc.data()!.content;
    if (!content) {
      throw new HttpsError('invalid-argument', 'Draft has no content');
    }

    try {
      logger.info('Starting grammar analysis', { essayId, draftId, contentLength: content.length });
      const analysis = await analyzeGrammarWithGemini(geminiApiKey.value(), content, draftRef);
      logger.info('Grammar analysis complete', { totalErrors: analysis.summary.totalErrors });
      await draftRef.update({ grammarAnalysis: analysis, grammarStatus: null });
      return analysis;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error('Grammar analysis failed', { error: errMsg, stack: errStack });
      if (error instanceof SyntaxError) {
        try {
          const analysis = await analyzeGrammarWithGemini(geminiApiKey.value(), content, draftRef);
          await draftRef.update({ grammarAnalysis: analysis, grammarStatus: null });
          return analysis;
        } catch (retryError: unknown) {
          const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
          logger.error('Grammar analysis retry also failed', { error: retryMsg });
          await draftRef.update({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
          throw new HttpsError('internal', 'Failed to analyze grammar. Please try again.');
        }
      }
      await draftRef.update({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
      throw new HttpsError('internal', `Failed to analyze grammar: ${errMsg}`);
    }
  }
);
```

- [ ] **Step 2: Add export to `functions/src/index.ts`**

Add this line after the existing exports:

```typescript
export { analyzeGrammar } from './analyzeGrammar';
```

The file should look like:
```typescript
import { initializeApp } from 'firebase-admin/app';
initializeApp();
export { submitEssay } from './submitEssay';
export { resubmitDraft } from './resubmitDraft';
export { analyzeTransitions } from './analyzeTransitions';
export { analyzeGrammar } from './analyzeGrammar';
export { deleteAccount } from './deleteAccount';
```

- [ ] **Step 3: Verify compilation**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add functions/src/analyzeGrammar.ts functions/src/index.ts
git commit -m "feat: add analyzeGrammar cloud function"
```

---

## Chunk 3: Frontend — Types

### Task 4: Add grammar types and extend Draft interface

**Files:**
- Modify: `src/types.ts`

- [ ] **Step 1: Add grammar interfaces to `src/types.ts`**

Add after the existing `TransitionAnalysis` interface (around line 75), before `EvaluationStatus`:

```typescript
// Grammar analysis types
export interface GrammarIssue {
  sentence: string;
  quotedText: string;
  comment: string;
  severity: 'error' | 'warning' | 'pattern';
}

export interface GrammarIssueCategory {
  locations: GrammarIssue[];
}

export interface GrammarAnalysis {
  commaSplices: GrammarIssueCategory;
  runOnSentences: GrammarIssueCategory;
  fragments: GrammarIssueCategory;
  subjectVerbAgreement: GrammarIssueCategory;
  pronounReference: GrammarIssueCategory;
  verbTenseConsistency: GrammarIssueCategory;
  parallelStructure: GrammarIssueCategory;
  punctuationErrors: GrammarIssueCategory;
  missingCommas: GrammarIssueCategory;
  sentenceVariety: {
    avgLength: number;
    distribution: {
      simple: number;
      compound: number;
      complex: number;
      compoundComplex: number;
    };
    comment: string;
  };
  activePassiveVoice: {
    activeCount: number;
    passiveCount: number;
    passiveInstances: { quotedText: string; comment: string }[];
  };
  modifierPlacement: {
    issues: { quotedText: string; comment: string }[];
  };
  wordiness: {
    instances: { quotedText: string; comment: string }[];
  };
  summary: {
    totalErrors: number;
    errorsByCategory: {
      commaSplices: number;
      runOnSentences: number;
      fragments: number;
      subjectVerbAgreement: number;
      pronounReference: number;
      verbTenseConsistency: number;
      parallelStructure: number;
      punctuationErrors: number;
      missingCommas: number;
    };
    overallComment: string;
    strengthAreas: string[];
    priorityFixes: string[];
  };
}
```

- [ ] **Step 2: Extend the Draft interface**

Add two fields to the existing `Draft` interface:

```typescript
  grammarAnalysis?: GrammarAnalysis | null;
  grammarStatus?: EvaluationStatus | null;
```

- [ ] **Step 3: Verify compilation**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add GrammarAnalysis types and extend Draft interface"
```

---

## Chunk 4: Frontend — GrammarView Component

### Task 5: Create GrammarView.tsx

**Files:**
- Create: `src/components/GrammarView.tsx`
- Reference: `src/components/TransitionView.tsx` (for structural pattern)

- [ ] **Step 1: Create `src/components/GrammarView.tsx`**

```tsx
// src/components/GrammarView.tsx
import { useMemo, useState } from 'react';
import type { GrammarAnalysis, GrammarIssue, GrammarIssueCategory } from '../types';

interface Props {
  content: string;
  analysis: GrammarAnalysis;
}

// Human-readable labels for each mechanics category
const MECHANICS_LABELS: Record<string, string> = {
  commaSplices: 'Comma Splices',
  runOnSentences: 'Run-on Sentences',
  fragments: 'Fragments',
  subjectVerbAgreement: 'Subject-Verb Agreement',
  pronounReference: 'Pronoun Reference',
  verbTenseConsistency: 'Verb Tense Consistency',
  parallelStructure: 'Parallel Structure',
  punctuationErrors: 'Punctuation Errors',
  missingCommas: 'Missing Commas',
};

const MECHANICS_KEYS = Object.keys(MECHANICS_LABELS) as (keyof typeof MECHANICS_LABELS)[];

export default function GrammarView({ content, analysis }: Props) {
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeIssue, setActiveIssue] = useState<GrammarIssue | null>(null);
  const [showPatterns, setShowPatterns] = useState(false);

  // Collect all issues with their category for rendering
  const allIssues = useMemo(() => {
    const issues: { issue: GrammarIssue; category: string }[] = [];
    for (const key of MECHANICS_KEYS) {
      const cat = analysis[key as keyof GrammarAnalysis] as GrammarIssueCategory;
      if (!cat?.locations) continue;
      for (const loc of cat.locations) {
        issues.push({ issue: loc, category: key });
      }
    }
    return issues;
  }, [analysis]);

  // Count by severity
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, pattern: 0 };
    for (const { issue } of allIssues) {
      c[issue.severity]++;
    }
    // Add pattern-level items from Tier 2
    c.pattern += (analysis.activePassiveVoice?.passiveInstances?.length || 0);
    c.pattern += (analysis.modifierPlacement?.issues?.length || 0);
    c.pattern += (analysis.wordiness?.instances?.length || 0);
    return c;
  }, [allIssues, analysis]);

  const total = counts.error + counts.warning + counts.pattern;

  // Filter issues for display
  const visibleIssues = useMemo(() => {
    return allIssues.filter(({ issue, category }) => {
      if (activeCategory && category !== activeCategory) return false;
      if (!showPatterns && issue.severity === 'pattern') return false;
      return true;
    });
  }, [allIssues, activeCategory, showPatterns]);

  // Build essay with inline underlines
  const essayElements = useMemo(() => {
    if (visibleIssues.length === 0) {
      return [<span key="full">{content}</span>];
    }

    // Find all issue positions in the text, using sentence context for disambiguation
    type IssueMatch = { start: number; end: number; issue: GrammarIssue; category: string };
    const matches: IssueMatch[] = [];
    const usedPositions = new Set<number>();

    for (const { issue, category } of visibleIssues) {
      const needle = issue.quotedText;
      if (!needle) continue;

      // Find all occurrences of the quotedText
      const candidates: number[] = [];
      let searchFrom = 0;
      while (searchFrom < content.length) {
        const idx = content.indexOf(needle, searchFrom);
        if (idx === -1) break;
        candidates.push(idx);
        searchFrom = idx + 1;
      }

      let bestIdx = -1;

      if (candidates.length === 1) {
        // Unique match — use it directly
        bestIdx = candidates[0];
      } else if (candidates.length > 1 && issue.sentence) {
        // Disambiguate using the sentence context
        const sentenceIdx = content.indexOf(issue.sentence);
        if (sentenceIdx >= 0) {
          // Find the candidate that falls within the sentence span
          for (const idx of candidates) {
            if (idx >= sentenceIdx && idx + needle.length <= sentenceIdx + issue.sentence.length && !usedPositions.has(idx)) {
              bestIdx = idx;
              break;
            }
          }
        }
      }

      // Fallback: first unused occurrence
      if (bestIdx === -1) {
        for (const idx of candidates) {
          if (!usedPositions.has(idx)) {
            bestIdx = idx;
            break;
          }
        }
      }

      if (bestIdx >= 0) {
        matches.push({ start: bestIdx, end: bestIdx + needle.length, issue, category });
        usedPositions.add(bestIdx);
      }
    }

    // Sort by position
    matches.sort((a, b) => a.start - b.start);

    // Build elements
    const elements: React.ReactNode[] = [];
    let cursor = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      // Skip overlapping matches
      if (m.start < cursor) continue;

      // Text before this match
      if (m.start > cursor) {
        elements.push(<span key={`t-${cursor}`}>{content.slice(cursor, m.start)}</span>);
      }

      const isActive = activeIssue === m.issue;

      elements.push(
        <span key={`m-${i}`}>
          <span
            className={`grammar-underline ${m.issue.severity} ${isActive ? 'active' : ''}`}
            onClick={() => setActiveIssue(isActive ? null : m.issue)}
            title={MECHANICS_LABELS[m.category] || m.category}
          >
            {content.slice(m.start, m.end)}
          </span>
          {isActive && (
            <div className={`grammar-comment ${m.issue.severity}`}>
              <span className="grammar-comment-label">{MECHANICS_LABELS[m.category] || m.category}</span>
              {m.issue.comment}
            </div>
          )}
        </span>
      );

      cursor = m.end;
    }

    // Remaining text
    if (cursor < content.length) {
      elements.push(<span key={`t-${cursor}`}>{content.slice(cursor)}</span>);
    }

    return elements;
  }, [content, visibleIssues, activeIssue]);

  // Check if we have any mechanics issues at all
  const hasMechanics = MECHANICS_KEYS.some(key => {
    const cat = analysis[key as keyof GrammarAnalysis] as GrammarIssueCategory;
    return cat?.locations?.length > 0;
  });

  const hasPatterns = (analysis.activePassiveVoice?.passiveInstances?.length || 0) > 0
    || (analysis.modifierPlacement?.issues?.length || 0) > 0
    || (analysis.wordiness?.instances?.length || 0) > 0;

  return (
    <div className="grammar-view">
      {/* Summary bar */}
      <div className="grammar-summary">
        <div className="grammar-summary-bar">
          {total > 0 ? (
            <>
              {counts.error > 0 && <div className="grammar-bar-segment error" style={{ width: `${(counts.error / total) * 100}%` }} />}
              {counts.warning > 0 && <div className="grammar-bar-segment warning" style={{ width: `${(counts.warning / total) * 100}%` }} />}
              {counts.pattern > 0 && <div className="grammar-bar-segment pattern" style={{ width: `${(counts.pattern / total) * 100}%` }} />}
            </>
          ) : (
            <div className="grammar-bar-segment clean" style={{ width: '100%' }} />
          )}
        </div>
        <div className="grammar-summary-legend">
          {counts.error > 0 && <span className="legend-item"><span className="legend-dot error" />{counts.error} error{counts.error !== 1 ? 's' : ''}</span>}
          {counts.warning > 0 && <span className="legend-item"><span className="legend-dot warning" />{counts.warning} warning{counts.warning !== 1 ? 's' : ''}</span>}
          {counts.pattern > 0 && <span className="legend-item"><span className="legend-dot pattern" />{counts.pattern} pattern{counts.pattern !== 1 ? 's' : ''}</span>}
          {total === 0 && <span className="legend-item"><span className="legend-dot clean" />No issues found</span>}
        </div>
        {analysis.activePassiveVoice && (
          <p className="grammar-passive-ratio">
            {analysis.activePassiveVoice.activeCount} active, {analysis.activePassiveVoice.passiveCount} passive
            {analysis.activePassiveVoice.activeCount + analysis.activePassiveVoice.passiveCount > 0 &&
              ` (${Math.round((analysis.activePassiveVoice.passiveCount / (analysis.activePassiveVoice.activeCount + analysis.activePassiveVoice.passiveCount)) * 100)}% passive)`
            }
          </p>
        )}
        <p className="grammar-summary-text">{analysis.summary.overallComment}</p>
      </div>

      {/* Strength areas + priority fixes */}
      <div className="grammar-callouts">
        {analysis.summary.strengthAreas.length > 0 && (
          <div className="grammar-callout strengths">
            <strong>Strengths</strong>
            <ul>{analysis.summary.strengthAreas.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        {analysis.summary.priorityFixes.length > 0 && (
          <div className="grammar-callout priorities">
            <strong>Fix First</strong>
            <ol>{analysis.summary.priorityFixes.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )}
      </div>

      {/* Category breakdown */}
      {(hasMechanics || hasPatterns) && (
        <div className="grammar-categories">
          {hasMechanics && (
            <div className="grammar-category-group">
              <h4 className="grammar-category-heading">Mechanics</h4>
              {MECHANICS_KEYS.map(key => {
                const cat = analysis[key as keyof GrammarAnalysis] as GrammarIssueCategory;
                const count = cat?.locations?.length || 0;
                if (count === 0) return null;
                const isActive = activeCategory === key;
                return (
                  <button
                    key={key}
                    className={`grammar-category-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveCategory(isActive ? null : key)}
                  >
                    {MECHANICS_LABELS[key]}
                    <span className="grammar-category-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
          {hasPatterns && (
            <div className="grammar-category-group">
              <h4 className="grammar-category-heading">Patterns</h4>
              <label className="grammar-pattern-toggle">
                <input type="checkbox" checked={showPatterns} onChange={e => setShowPatterns(e.target.checked)} />
                Show patterns in essay
              </label>
            </div>
          )}
        </div>
      )}

      {/* Sentence variety */}
      {analysis.sentenceVariety && (
        <div className="grammar-sentence-variety">
          <h4>Sentence Variety</h4>
          <div className="grammar-variety-stats">
            <span>Avg length: {analysis.sentenceVariety.avgLength} words</span>
            <span>Simple: {analysis.sentenceVariety.distribution.simple}</span>
            <span>Compound: {analysis.sentenceVariety.distribution.compound}</span>
            <span>Complex: {analysis.sentenceVariety.distribution.complex}</span>
            <span>Compound-Complex: {analysis.sentenceVariety.distribution.compoundComplex}</span>
          </div>
          <p className="grammar-variety-comment">{analysis.sentenceVariety.comment}</p>
        </div>
      )}

      {/* The essay with inline markers */}
      <div className="grammar-essay">
        {essayElements}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```bash
git add src/components/GrammarView.tsx
git commit -m "feat: add GrammarView component with summary, categories, and inline markers"
```

---

## Chunk 5: Frontend — Tab Integration & CSS

### Task 6: Wire up Grammar tab in EssayPage

**Files:**
- Modify: `src/pages/EssayPage.tsx`

- [ ] **Step 1: Add imports**

Add to the existing imports at the top of `EssayPage.tsx`:

```typescript
import GrammarView from '../components/GrammarView';
import type { GrammarAnalysis } from '../types';
```

- [ ] **Step 2: Expand state**

Change line 20 from:
```typescript
const [activeView, setActiveView] = useState<'feedback' | 'transitions'>('feedback');
```
To:
```typescript
const [activeView, setActiveView] = useState<'feedback' | 'transitions' | 'grammar'>('feedback');
```

Add new state after line 22 (`transitionError`):
```typescript
const [grammarLoading, setGrammarLoading] = useState(false);
const [grammarError, setGrammarError] = useState<string | null>(null);
```

- [ ] **Step 3: Add grammar tab handler**

Add after the `handleTransitionsTab` callback (after line 61):

```typescript
const handleGrammarTab = useCallback(async () => {
  setActiveView('grammar');
  const activeDraftId_ = selectedDraftId ?? drafts[0]?.id;
  const activeDraft_ = drafts.find((d) => d.id === activeDraftId_) ?? drafts[0];
  if (!activeDraft_ || activeDraft_.grammarAnalysis) return;
  if (activeDraft_.grammarStatus && activeDraft_.grammarStatus.stage !== 'error') return;

  setGrammarLoading(true);
  setGrammarError(null);
  try {
    const analyzeGrammar = httpsCallable<
      { essayId: string; draftId: string },
      GrammarAnalysis
    >(functions, 'analyzeGrammar', { timeout: 180000 });
    await analyzeGrammar({ essayId: essayId!, draftId: activeDraft_.id });
  } catch {
    setGrammarError('Failed to analyze grammar. Please try again.');
  } finally {
    setGrammarLoading(false);
  }
}, [drafts, selectedDraftId, essayId]);
```

- [ ] **Step 4: Add Grammar tab button**

Add a third button inside the `.view-toggle` div (after the Transitions button, around line 196):

```tsx
<button
  className={`view-toggle-btn ${activeView === 'grammar' ? 'active' : ''}`}
  onClick={handleGrammarTab}
>
  Grammar
</button>
```

- [ ] **Step 5: Add Grammar view rendering**

Add after the transitions view block (after line 243, before the essay footer):

```tsx
{/* Grammar analysis view */}
{activeView === 'grammar' && (
  <>
    {activeDraft.grammarAnalysis ? (
      <GrammarView
        content={activeDraft.content}
        analysis={activeDraft.grammarAnalysis}
      />
    ) : grammarError ? (
      <div className="error-state">
        <p>{grammarError}</p>
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleGrammarTab}>
          Retry
        </button>
      </div>
    ) : grammarLoading || activeDraft.grammarStatus ? (
      <div className="loading-state">
        <div className="spinner" />
        <p className="progress-message">
          {activeDraft.grammarStatus?.message || 'Analyzing grammar...'}
        </p>
        {activeDraft.grammarStatus?.stage === 'thinking' && (
          <p className="progress-stage">Gemini is thinking...</p>
        )}
        {activeDraft.grammarStatus?.stage === 'generating' && (
          <p className="progress-stage">Writing analysis...</p>
        )}
      </div>
    ) : (
      <div className="loading-state">
        <p>Click the Grammar tab to analyze this essay's grammar.</p>
      </div>
    )}
  </>
)}
```

- [ ] **Step 6: Verify compilation**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 7: Commit**

```bash
git add src/pages/EssayPage.tsx
git commit -m "feat: wire up Grammar tab in EssayPage"
```

---

### Task 7: Add grammar CSS styles

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add grammar styles**

Append after the transition styles (after line 748):

```css
/* ═══ Grammar View — inline error markers ═══ */
.grammar-view {
  margin-bottom: 24px;
}

/* Summary bar */
.grammar-summary {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 16px 20px;
  margin-bottom: 16px;
}
.grammar-summary-bar {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: var(--color-border);
  margin-bottom: 10px;
}
.grammar-bar-segment { transition: width 0.3s; }
.grammar-bar-segment.error { background: var(--color-red); }
.grammar-bar-segment.warning { background: var(--color-yellow); }
.grammar-bar-segment.pattern { background: var(--color-primary); }
.grammar-bar-segment.clean { background: var(--color-green); }

.grammar-summary-legend {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  margin-bottom: 8px;
}
.legend-dot.error { background: var(--color-red); }
.legend-dot.warning { background: var(--color-yellow); }
.legend-dot.pattern { background: var(--color-primary); }
.legend-dot.clean { background: var(--color-green); }

.grammar-passive-ratio {
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}
.grammar-summary-text {
  font-size: 14px;
  color: var(--color-text-secondary);
  line-height: 1.6;
}

/* Callout cards */
.grammar-callouts {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}
.grammar-callout {
  flex: 1;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px 16px;
  font-size: 13px;
}
.grammar-callout strong {
  display: block;
  margin-bottom: 6px;
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
}
.grammar-callout.strengths { border-left: 3px solid var(--color-green); }
.grammar-callout.priorities { border-left: 3px solid var(--color-red); }
.grammar-callout ul, .grammar-callout ol {
  margin: 0;
  padding-left: 18px;
}
.grammar-callout li {
  margin-bottom: 4px;
  line-height: 1.4;
}

/* Category breakdown */
.grammar-categories {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.grammar-category-heading {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin: 0 0 8px 0;
}
.grammar-category-group {
  margin-bottom: 12px;
}
.grammar-category-group:last-child { margin-bottom: 0; }
.grammar-category-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  margin: 0 6px 6px 0;
  font-size: 12px;
  font-weight: 500;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: 16px;
  cursor: pointer;
  color: var(--color-text);
  transition: all 0.15s;
}
.grammar-category-btn:hover { background: var(--color-surface); border-color: var(--color-text-secondary); }
.grammar-category-btn.active { background: var(--color-primary); color: white; border-color: var(--color-primary); }
.grammar-category-count {
  background: rgba(0,0,0,0.08);
  padding: 1px 7px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.grammar-category-btn.active .grammar-category-count {
  background: rgba(255,255,255,0.2);
}
.grammar-pattern-toggle {
  font-size: 12px;
  color: var(--color-text-secondary);
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Sentence variety */
.grammar-sentence-variety {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 12px 16px;
  margin-bottom: 16px;
}
.grammar-sentence-variety h4 {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin: 0 0 8px 0;
}
.grammar-variety-stats {
  display: flex;
  gap: 16px;
  flex-wrap: wrap;
  font-size: 12px;
  color: var(--color-text-secondary);
  margin-bottom: 6px;
}
.grammar-variety-comment {
  font-size: 13px;
  color: var(--color-text-secondary);
  line-height: 1.5;
}

/* Essay with inline markers */
.grammar-essay {
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 10px;
  padding: 32px;
  font-size: 15px;
  line-height: 2;
  white-space: pre-wrap;
}

/* Underline markers */
.grammar-underline {
  cursor: pointer;
  transition: background 0.15s;
  border-radius: 2px;
  padding: 1px 0;
}
.grammar-underline.error {
  text-decoration: underline wavy var(--color-red);
  text-underline-offset: 3px;
}
.grammar-underline.warning {
  text-decoration: underline wavy var(--color-yellow);
  text-underline-offset: 3px;
}
.grammar-underline.pattern {
  text-decoration: underline dashed var(--color-primary);
  text-underline-offset: 3px;
}
.grammar-underline:hover {
  background: rgba(0,0,0,0.04);
}
.grammar-underline.active {
  background: rgba(0,0,0,0.06);
}

/* Comment popup */
.grammar-comment {
  display: block;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 8px;
  padding: 10px 14px;
  font-size: 13px;
  line-height: 1.5;
  color: var(--color-text-secondary);
  margin: 4px 0 8px 0;
}
.grammar-comment.error { border-left: 3px solid var(--color-red); }
.grammar-comment.warning { border-left: 3px solid var(--color-yellow); }
.grammar-comment.pattern { border-left: 3px solid var(--color-primary); }
.grammar-comment-label {
  display: block;
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  color: var(--color-text-secondary);
  margin-bottom: 4px;
}
```

- [ ] **Step 2: Verify the app builds**

Run: `cd /home/ssilver/development/essay-grader && npm run build`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/index.css
git commit -m "feat: add grammar view CSS styles"
```

---

## Chunk 6: Manual Verification

### Task 8: End-to-end smoke test

- [ ] **Step 1: Deploy the new cloud function**

Run: `cd /home/ssilver/development/essay-grader/functions && ./scripts/smart-deploy.sh`
Expected: `analyzeGrammar` function deploys successfully

- [ ] **Step 2: Start the dev server**

Run: `cd /home/ssilver/development/essay-grader && npm run dev`
Expected: Dev server starts on localhost

- [ ] **Step 3: Test the Grammar tab**

1. Open an existing essay in the browser
2. Click the "Grammar" tab
3. Verify: spinner appears with progress messages
4. Verify: after ~60s, the grammar analysis renders with summary bar, category breakdown, and inline markers
5. Verify: clicking an underlined issue shows the comment popup
6. Verify: clicking a category button filters the essay view
7. Verify: switching to Feedback or Transitions tabs still works
8. Verify: returning to Grammar tab shows cached results (no re-analysis)

- [ ] **Step 4: Test empty state**

If you have a well-written essay with few/no grammar issues, verify the green summary bar and "No issues found" state renders correctly.

- [ ] **Step 5: Commit any fixes found during testing**

Stage only the specific files that were adjusted during testing, then commit:

```bash
git commit -m "fix: grammar tab adjustments from smoke testing"
```
