import { GoogleGenAI } from '@google/genai';
import type { DocumentReference } from 'firebase-admin/firestore';
import { splitSentences } from './sentenceSplitter';

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

export interface SentenceTransition {
  paragraph: number;
  fromSentence: number;
  toSentence: number;
  quality: 'smooth' | 'adequate' | 'weak' | 'missing';
  comment: string;
}

export interface ParagraphTransition {
  fromParagraph: number;
  toParagraph: number;
  quality: 'smooth' | 'adequate' | 'weak' | 'missing';
  comment: string;
}

export interface TransitionAnalysis {
  sentenceTransitions: SentenceTransition[];
  paragraphTransitions: ParagraphTransition[];
  summary: string;
}

/**
 * Split essay into numbered paragraphs and sentences for the prompt.
 * Returns the formatted text to send to Gemini.
 */
export function formatEssayForTransitionAnalysis(content: string): string {
  const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
  // Fallback: if no double-newlines, split on single newlines
  const effectiveParagraphs = paragraphs.length > 1
    ? paragraphs
    : content.split(/\n/).filter(p => p.trim().length > 0);

  const lines: string[] = [];

  for (let pi = 0; pi < effectiveParagraphs.length; pi++) {
    const para = effectiveParagraphs[pi].trim();
    const sentences = splitSentences(para);

    for (let si = 0; si < sentences.length; si++) {
      const s = sentences[si].trim();
      if (s.length === 0) continue;
      lines.push(`¶${pi + 1} S${si + 1}: "${s}"`);
    }

    if (pi < effectiveParagraphs.length - 1) {
      lines.push(`--- PARAGRAPH BREAK (¶${pi + 1} → ¶${pi + 2}) ---`);
    }
  }

  return lines.join('\n');
}

export function buildTransitionPrompt(content: string): string {
  const formatted = formatEssayForTransitionAnalysis(content);
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
  const ai = new GoogleGenAI({ apiKey });
  const prompt = buildTransitionPrompt(content);

  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: TRANSITION_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: TRANSITION_SCHEMA,
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
            await progressRef.update({ transitionStatus: { stage: 'thinking', message: headline } });
            lastProgressWrite = now;
          }
        }
      } else {
        if (stage === 'thinking') {
          stage = 'generating';
          if (progressRef) {
            await progressRef.update({ transitionStatus: { stage: 'generating', message: 'Analyzing transitions...' } });
          }
        }
        outputText += part.text || '';
      }
    }
  }

  if (!outputText) {
    throw new Error('Gemini returned an empty response');
  }

  return JSON.parse(outputText) as TransitionAnalysis;
}
