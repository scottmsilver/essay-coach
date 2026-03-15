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
