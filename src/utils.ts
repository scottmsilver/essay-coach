import { TRAIT_KEYS, TRAIT_LABELS } from './types';
import type { Evaluation, TraitAnnotation, CriteriaAnalysis, CoherenceAnalysis, ParagraphRelation, StructureAnalysis, ParagraphClassification } from './types';

export function collectAnnotations(evaluation: Evaluation): TraitAnnotation[] {
  const result: TraitAnnotation[] = [];
  for (const traitKey of TRAIT_KEYS) {
    const trait = evaluation.traits[traitKey];
    if (!trait?.annotations) continue;
    for (const ann of trait.annotations) {
      result.push({ ...ann, traitKey, traitLabel: TRAIT_LABELS[traitKey] });
    }
  }
  return result;
}

export interface CriteriaAnnotation {
  quotedText: string;
  comment: string;
  criterionIndex: number;
  criterionText: string;
}

export function collectCriteriaAnnotations(analysis: CriteriaAnalysis): CriteriaAnnotation[] {
  const result: CriteriaAnnotation[] = [];
  for (let i = 0; i < analysis.criteria.length; i++) {
    const criterion = analysis.criteria[i];
    for (const ann of criterion.annotations) {
      result.push({
        ...ann,
        criterionIndex: i,
        criterionText: criterion.criterion,
      });
    }
  }
  return result;
}

export interface CoherenceAnnotation {
  quotedText: string;
  comment: string;
  /** 'praise' for supports + contrasts_acknowledged, 'suggestion' for problems. */
  kind: 'praise' | 'suggestion';
  paragraphIndex: number;
  relation: ParagraphRelation;
  relationLabel: string;
}

const COHERENCE_RELATION_LABEL: Record<ParagraphRelation, string> = {
  supports: 'Supports',
  contrasts_acknowledged: 'Counterargument',
  contrasts_unacknowledged: 'Contradicts',
  off_topic: 'Off topic',
};

export function collectCoherenceAnnotations(analysis: CoherenceAnalysis): CoherenceAnnotation[] {
  const result: CoherenceAnnotation[] = [];
  for (const para of analysis.paragraphs) {
    if (!para.quotedText) continue;
    const isPositive = para.relation === 'supports' || para.relation === 'contrasts_acknowledged';
    result.push({
      quotedText: para.quotedText,
      comment: para.comment,
      kind: isPositive ? 'praise' : 'suggestion',
      paragraphIndex: para.index,
      relation: para.relation,
      relationLabel: COHERENCE_RELATION_LABEL[para.relation],
    });
  }
  return result;
}

export interface StructureAnnotation {
  quotedText: string;
  comment: string;
  /** 'praise' for complete paragraphs, 'suggestion' for missing components. */
  kind: 'praise' | 'suggestion';
  paragraphIndex: number;
  classification: ParagraphClassification;
  classificationLabel: string;
}

const STRUCTURE_CLASSIFICATION_LABEL: Record<ParagraphClassification, string> = {
  complete: 'Complete',
  missing_analysis: 'Missing analysis',
  missing_evidence: 'Missing evidence',
  missing_claim: 'Missing claim',
  off_pattern: 'Off pattern',
};

/** Take the first 5-15 words of a paragraph as a fallback anchor. */
function fallbackQuote(paragraph: string): string {
  const words = paragraph.trim().split(/\s+/);
  const slice = words.slice(0, Math.min(words.length, 12));
  return slice.join(' ');
}

export function collectStructureAnnotations(analysis: StructureAnalysis, content?: string): StructureAnnotation[] {
  const result: StructureAnnotation[] = [];
  // Split content into paragraphs once so we can fall back to a slice when no
  // component is present in a missing_* paragraph.
  const paragraphs = content
    ? content.trim().split(/\n\s*\n+/).filter((p) => p.trim())
    : [];

  for (const para of analysis.paragraphs) {
    if (para.classification === 'off_pattern') continue;

    const label = STRUCTURE_CLASSIFICATION_LABEL[para.classification];

    if (para.classification === 'complete') {
      // Praise the analysis quote when present; fall back to evidence then claim.
      const quote =
        para.analysis.quotedText ??
        para.evidence.quotedText ??
        para.claim.quotedText;
      if (!quote) continue;
      result.push({
        quotedText: quote,
        comment: para.comment,
        kind: 'praise',
        paragraphIndex: para.index,
        classification: para.classification,
        classificationLabel: label,
      });
      continue;
    }

    // missing_* paragraphs: anchor on whichever component IS present
    let quote: string | null =
      para.analysis.quotedText ??
      para.evidence.quotedText ??
      para.claim.quotedText;

    if (!quote) {
      // 1-indexed paragraph -> 0-indexed array
      const idx = para.index - 1;
      if (idx >= 0 && idx < paragraphs.length) {
        quote = fallbackQuote(paragraphs[idx]);
      }
    }

    if (!quote) continue;

    result.push({
      quotedText: quote,
      comment: para.comment,
      kind: 'suggestion',
      paragraphIndex: para.index,
      classification: para.classification,
      classificationLabel: label,
    });
  }
  return result;
}

/**
 * Classify an annotation as praise or suggestion.
 *
 * Gemini now labels each annotation with `kind`. For legacy drafts written
 * before that field existed, fall back to the old punctuation heuristic so
 * the UI still shows something reasonable.
 */
export function classifyAnnotation(ann: { comment: string; kind?: 'praise' | 'suggestion' }): 'praise' | 'suggestion' {
  if (ann.kind) return ann.kind;
  return ann.comment.includes('?') ? 'suggestion' : 'praise';
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function scoreLevel(score: number): string {
  if (score <= 2) return 'low';
  if (score <= 4) return 'mid';
  return 'high';
}

export function scoreClass(score: number): string {
  return `score-${scoreLevel(score)}`;
}

export function scoreColor(score: number): string {
  if (score <= 2) return 'var(--color-red)';
  if (score <= 4) return 'var(--color-yellow)';
  return 'var(--color-green)';
}

const SCORE_LABELS: Record<number, string> = {
  1: 'Beginning',
  2: 'Emerging',
  3: 'Developing',
  4: 'Capable',
  5: 'Strong',
  6: 'Exceptional',
};

export function scoreLabel(score: number): string {
  return SCORE_LABELS[score] ?? '';
}

export function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMs < 0 || diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.getDate() === yesterday.getDate()
    && date.getMonth() === yesterday.getMonth()
    && date.getFullYear() === yesterday.getFullYear();

  const isSameDay = date.getDate() === now.getDate()
    && date.getMonth() === now.getMonth()
    && date.getFullYear() === now.getFullYear();

  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (isSameDay && diffHr < 24) return `${diffHr}h ago`;
  if (isYesterday) return `Yesterday, ${timeStr}`;

  if (date.getFullYear() === now.getFullYear()) {
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}
