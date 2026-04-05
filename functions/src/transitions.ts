import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';
import { splitSentences, splitParagraphs, splitSentencesAI } from './sentenceSplitter';

export const TRANSITION_SYSTEM_PROMPT = `You analyze transitions between consecutive sentences and between paragraphs in student essays.

Rate each transition:
- smooth: natural, invisible flow
- adequate: connected but could be stronger
- weak: unclear, abrupt, or generic connector without real linking
- missing: no discernible connection

Comments: use Socratic questions referencing specific text. Do NOT rewrite. 1-2 sentences max.
For smooth transitions, briefly note WHY it works.`;

export const TRANS_COVERAGE_BOOST = `\n\n## EXHAUSTIVE COVERAGE REQUIREMENT
You MUST produce one sentenceTransition entry for EVERY consecutive sentence pair in EVERY paragraph.
If a paragraph has N sentences, you must produce exactly N-1 sentenceTransition entries for it.
Do NOT skip any sentence pairs. Do NOT summarize multiple transitions into one entry.
Count: ¶1 has sentences S1..Sn → produce n-1 entries (S1→S2, S2→S3, ..., S(n-1)→Sn).
Repeat for every paragraph. Missing entries = FAILURE.`;

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
    const pi = ki + 1; // 1-based paragraph index
    const sents = sentences[keys[ki]];
    for (let si = 0; si < sents.length; si++) {
      lines.push(`${pi}.${si + 1} ${sents[si]}`);
    }

    if (ki < keys.length - 1) {
      lines.push('---');
    }
  }

  return lines.join('\n');
}

export function buildTransitionPrompt(formatted: string): string {
  return `Analyze every transition in this essay. Format: P.S = paragraph.sentence number.

Rate each consecutive sentence pair and each paragraph break: smooth, adequate, weak, missing.

${formatted}

Analyze EVERY transition. Do not skip any.`;
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
