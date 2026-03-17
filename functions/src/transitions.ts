import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';
import { splitSentences, splitParagraphs, splitSentencesAI } from './sentenceSplitter';

const TRANSITION_SYSTEM_PROMPT = `You are an expert writing coach specializing in essay structure and flow. Your job is to analyze EVERY transition in a student's essay — between consecutive sentences and between paragraphs.

A "transition" is the seam between two adjacent units of text. Good transitions create flow; weak or missing transitions make writing feel choppy or disconnected.

## What to look for

**Sentence-to-sentence transitions (within a paragraph):**
- Logical connectors (however, furthermore, therefore, similarly, in contrast)
- Pronoun references that link back ("This approach...", "These findings...")
- Repeated key terms or synonyms that create cohesion
- Causal or temporal chains (because of this, after, as a result)
- Whether the new sentence logically follows from the previous one
- Abrupt topic shifts within a paragraph

**Paragraph-to-paragraph transitions:**
- Whether the opening sentence of the new paragraph connects to the closing idea of the previous one
- Topic sentences that bridge concepts
- Logical progression (from general to specific, from problem to solution, chronological)
- Whether the reader can follow WHY you moved to this new paragraph

## Rating scale

- **smooth**: The transition feels natural and invisible. The reader flows from one idea to the next without friction.
- **adequate**: There is a logical connection, but it could be stronger or more elegant.
- **weak**: The connection exists but is unclear, abrupt, or relies on a generic transition word without real logical linking.
- **missing**: There is no discernible connection. The reader has to work to understand why these two ideas are next to each other.

## Feedback style

Use Socratic questions to guide the student. Do NOT rewrite their text for them.
- BAD: "Add 'Furthermore' at the beginning of this sentence."
- GOOD: "What logical relationship connects this idea to the previous one? Once you know that, you can signal it to your reader."

Be specific about WHAT is weak and WHY, then ask a guiding question.

For smooth transitions, briefly explain WHY it works so the student can replicate the technique elsewhere.`;

const TRANSITION_SCHEMA = {
  type: 'object' as const,
  properties: {
    sentenceTransitions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          paragraph: { type: 'number' as const },
          fromSentence: { type: 'number' as const },
          toSentence: { type: 'number' as const },
          quality: { type: 'string' as const, enum: ['smooth', 'adequate', 'weak', 'missing'] },
          comment: { type: 'string' as const },
        },
        required: ['paragraph', 'fromSentence', 'toSentence', 'quality', 'comment'],
      },
    },
    paragraphTransitions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          fromParagraph: { type: 'number' as const },
          toParagraph: { type: 'number' as const },
          quality: { type: 'string' as const, enum: ['smooth', 'adequate', 'weak', 'missing'] },
          comment: { type: 'string' as const },
        },
        required: ['fromParagraph', 'toParagraph', 'quality', 'comment'],
      },
    },
    summary: { type: 'string' as const },
  },
  required: ['sentenceTransitions', 'paragraphTransitions', 'summary'],
};

import type { TransitionAnalysis } from './shared/transitionTypes';
export type { SentenceTransition, ParagraphTransition, TransitionAnalysis } from './shared/transitionTypes';

/**
 * Split essay into paragraphs and sentences.
 * Uses Gemma 3 4B (free via Gemini API) when apiKey is provided, with regex fallback.
 * Returns both the formatted prompt text and the sentence arrays for storage.
 */
export async function splitEssayIntoSentences(content: string, apiKey?: string): Promise<string[][]> {
  const paragraphs = splitParagraphs(content);
  const raw = apiKey
    ? await splitSentencesAI(apiKey, paragraphs)
    : paragraphs.map(splitSentences);

  // Filter empties so sentence indices are always dense (no gaps)
  return raw.map(arr => arr.map(s => s.trim()).filter(s => s.length > 0));
}

export function formatSentencesForPrompt(sentences: string[][]): string {
  const lines: string[] = [];

  for (let pi = 0; pi < sentences.length; pi++) {
    for (let si = 0; si < sentences[pi].length; si++) {
      lines.push(`¶${pi + 1} S${si + 1}: "${sentences[pi][si]}"`);
    }

    if (pi < sentences.length - 1) {
      lines.push(`--- PARAGRAPH BREAK (¶${pi + 1} → ¶${pi + 2}) ---`);
    }
  }

  return lines.join('\n');
}

export function buildTransitionPrompt(formatted: string): string {
  return `Analyze every transition in this student essay. The essay has been split into numbered paragraphs (¶) and sentences (S) for your reference.

Rate each sentence-to-sentence transition within each paragraph, and each paragraph-to-paragraph transition. Use the rating scale: smooth, adequate, weak, missing.

Here is the essay:

${formatted}

Analyze EVERY transition point. Do not skip any.`;
}

export async function analyzeTransitionsWithGemini(
  apiKey: string,
  content: string,
  progressRef?: DocumentReference,
): Promise<TransitionAnalysis> {
  // Split sentences with Gemma 3 4B (falls back to regex)
  const sentences = await splitEssayIntoSentences(content, apiKey);
  const formatted = formatSentencesForPrompt(sentences);
  const prompt = buildTransitionPrompt(formatted);

  const outputText = await streamGeminiJson({
    apiKey,
    contents: prompt,
    systemInstruction: TRANSITION_SYSTEM_PROMPT,
    responseSchema: TRANSITION_SCHEMA,
    progressRef,
    statusField: 'transitionStatus',
    generatingMessage: 'Analyzing transitions...',
  });

  const analysis = JSON.parse(outputText) as TransitionAnalysis;
  analysis.sentences = sentences;
  return analysis;
}
