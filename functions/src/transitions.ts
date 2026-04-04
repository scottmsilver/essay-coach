import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';
import { splitSentences, splitParagraphs, splitSentencesAI } from './sentenceSplitter';

export const TRANSITION_SYSTEM_PROMPT = `You are an expert writing coach specializing in essay structure and flow. Your job is to analyze EVERY transition in a student's essay — between consecutive sentences and between paragraphs.

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

export const TRANSITION_SCHEMA = {
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
export async function splitEssayIntoSentences(content: string, apiKey?: string): Promise<Record<string, string[]>> {
  const paragraphs = splitParagraphs(content);
  const raw = apiKey
    ? await splitSentencesAI(apiKey, paragraphs)
    : paragraphs.map(splitSentences);

  // Skip empty paragraphs so keys are dense and ¶N labels stay in sync.
  // Return as Record<string, string[]> for Firestore compatibility (no nested arrays).
  const result: Record<string, string[]> = {};
  let ki = 0;
  for (let i = 0; i < raw.length; i++) {
    const filtered = raw[i].map(s => s.trim()).filter(s => s.length > 0);
    if (filtered.length > 0) {
      result[String(ki++)] = filtered;
    }
  }
  return result;
}

export function formatSentencesForPrompt(sentences: Record<string, string[]>): string {
  const keys = Object.keys(sentences).sort((a, b) => Number(a) - Number(b));
  const lines: string[] = [];

  for (let ki = 0; ki < keys.length; ki++) {
    const pi = ki; // paragraph index (0-based)
    const sents = sentences[keys[ki]];
    for (let si = 0; si < sents.length; si++) {
      lines.push(`¶${pi + 1} S${si + 1}: "${sents[si]}"`);
    }

    if (ki < keys.length - 1) {
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

/**
 * For each transition, check if both adjacent sentences are identical to the
 * previous run. If so, carry forward the previous result to prevent flipping.
 */
/**
 * Compare at the RAW PARAGRAPH level, not the sentence level.
 * This avoids dependency on Gemini's sentence splitting being deterministic.
 * If a paragraph's full text is unchanged, all transitions within it (and
 * paragraph transitions touching it) carry forward from the previous run.
 */
export function stabilizeResults(
  fresh: TransitionAnalysis,
  previous: TransitionAnalysis | null,
  currentSentences: Record<string, string[]>,
): TransitionAnalysis {
  if (!previous?.sentences) return fresh;
  const prevSent = previous.sentences!;

  // Join sentences back into paragraph text for comparison
  const paraText = (sents: Record<string, string[]>, paraIdx: number): string =>
    (sents[String(paraIdx)] ?? []).join(' ').trim();

  // Build set of unchanged paragraph indices (0-indexed)
  const unchangedParas = new Set<number>();
  const maxPara = Math.max(
    ...Object.keys(currentSentences).map(Number),
    ...Object.keys(prevSent).map(Number),
  );
  for (let p = 0; p <= maxPara; p++) {
    const curr = paraText(currentSentences, p);
    const prev = paraText(prevSent, p);
    if (curr && prev && curr === prev) {
      unchangedParas.add(p);
    }
  }

  // Stabilize sentence transitions: carry forward if the whole paragraph is unchanged
  for (let i = 0; i < fresh.sentenceTransitions.length; i++) {
    const t = fresh.sentenceTransitions[i];
    const paraIdx = t.paragraph - 1; // 1-indexed → 0-indexed
    if (unchangedParas.has(paraIdx)) {
      const match = previous.sentenceTransitions.find(
        (pt: { paragraph: number; fromSentence: number; toSentence: number }) =>
          pt.paragraph === t.paragraph && pt.fromSentence === t.fromSentence && pt.toSentence === t.toSentence
      );
      if (match) {
        fresh.sentenceTransitions[i] = match;
      }
    }
  }

  // Stabilize paragraph transitions: carry forward if BOTH paragraphs are unchanged
  for (let i = 0; i < fresh.paragraphTransitions.length; i++) {
    const t = fresh.paragraphTransitions[i];
    if (unchangedParas.has(t.fromParagraph - 1) && unchangedParas.has(t.toParagraph - 1)) {
      const match = previous.paragraphTransitions.find(
        (pt: { fromParagraph: number; toParagraph: number }) =>
          pt.fromParagraph === t.fromParagraph && pt.toParagraph === t.toParagraph
      );
      if (match) {
        fresh.paragraphTransitions[i] = match;
      }
    }
  }

  return fresh;
}

export async function analyzeTransitionsWithGemini(
  apiKey: string,
  content: string,
  progressRef?: DocumentReference,
  previousAnalysis?: TransitionAnalysis | null,
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

  let analysis = JSON.parse(outputText) as TransitionAnalysis;
  analysis.sentences = sentences;

  // Pass 2: re-evaluate weak/missing transitions with full paragraph context
  analysis = await contextualRecheck(apiKey, analysis, sentences, progressRef);

  // Stabilize: carry forward results for unchanged paragraph text
  if (previousAnalysis) {
    analysis = stabilizeResults(analysis, previousAnalysis, sentences);
  }

  return analysis;
}

// ── Pass 2: Contextual Recheck ──────────────────────────────────────────

const RECHECK_SYSTEM_PROMPT = `You are a writing coach re-evaluating transition quality with full context.

Pass 1 flagged certain sentence transitions as "weak" or "missing" by looking only at adjacent sentence pairs. But essays often connect sentences through earlier context — a topic sentence, a shared theme, or a callback to a previous point.

Your job: for each flagged transition, read the FULL paragraph and decide if the connection is actually made through broader context.

For each item, return one of:
- "upgrade" — the broader context resolves the transition. Upgrade to "adequate" or "smooth" and explain what connection Pass 1 missed.
- "keep" — it is genuinely weak/missing even in context. Keep the original rating and comment.

Be honest. Only upgrade when there is a real contextual link that Pass 1 missed. Do not upgrade just to be nice.`;

const RECHECK_SCHEMA = {
  type: 'object' as const,
  properties: {
    results: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          id: { type: 'string' as const },
          verdict: { type: 'string' as const, enum: ['upgrade', 'keep'] },
          newQuality: { type: 'string' as const, enum: ['smooth', 'adequate', 'weak', 'missing'] },
          reason: { type: 'string' as const },
        },
        required: ['id', 'verdict', 'newQuality', 'reason'],
      },
    },
  },
  required: ['results'],
};

interface RecheckResult {
  results: {
    id: string;
    verdict: 'upgrade' | 'keep';
    newQuality: 'smooth' | 'adequate' | 'weak' | 'missing';
    reason: string;
  }[];
}

async function contextualRecheck(
  apiKey: string,
  analysis: TransitionAnalysis,
  sentences: Record<string, string[]>,
  progressRef?: DocumentReference,
): Promise<TransitionAnalysis> {
  // Collect weak/missing sentence transitions
  const flagged = analysis.sentenceTransitions.filter(
    t => t.quality === 'weak' || t.quality === 'missing'
  );

  if (flagged.length === 0) return analysis;

  // Build the recheck prompt with full paragraph context for each flagged transition
  const items: string[] = [];
  for (const t of flagged) {
    const paraKey = String(t.paragraph - 1);
    const paraSents = sentences[paraKey];
    if (!paraSents) continue;

    const id = `¶${t.paragraph}-S${t.fromSentence}-S${t.toSentence}`;
    const fullPara = paraSents.map((s, i) => `  S${i + 1}: "${s}"`).join('\n');
    items.push(
      `ID: ${id}\n` +
      `Pass 1 rating: ${t.quality}\n` +
      `Pass 1 comment: ${t.comment}\n` +
      `Flagged pair: S${t.fromSentence + 1} → S${t.toSentence + 1}\n` +
      `Full paragraph ¶${t.paragraph}:\n${fullPara}`
    );
  }

  const prompt = `Re-evaluate these ${flagged.length} transitions that Pass 1 flagged as weak or missing. For each one, read the full paragraph context and decide if the connection is actually made through an earlier sentence.\n\n${items.join('\n\n---\n\n')}`;

  try {
    const outputText = await streamGeminiJson({
      apiKey,
      contents: prompt,
      systemInstruction: RECHECK_SYSTEM_PROMPT,
      responseSchema: RECHECK_SCHEMA,
      progressRef,
      statusField: 'transitionStatus',
      generatingMessage: 'Re-checking transitions in context...',
    });

    const recheck = JSON.parse(outputText) as RecheckResult;

    // Apply upgrades
    for (const r of recheck.results) {
      if (r.verdict !== 'upgrade') continue;

      // Parse the ID to find the matching transition
      const match = /¶(\d+)-S(\d+)-S(\d+)/.exec(r.id);
      if (!match) continue;
      const [, para, from, to] = match.map(Number);

      const idx = analysis.sentenceTransitions.findIndex(
        t => t.paragraph === para && t.fromSentence === from && t.toSentence === to
      );
      if (idx >= 0) {
        analysis.sentenceTransitions[idx].quality = r.newQuality;
        analysis.sentenceTransitions[idx].comment = r.reason;
      }
    }
  } catch {
    // Pass 2 is best-effort. If it fails, keep pass 1 results.
  }

  return analysis;
}
