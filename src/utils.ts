import { TRAIT_KEYS, TRAIT_LABELS } from './types';
import type { Evaluation, TraitAnnotation } from './types';

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

export function classifyAnnotation(comment: string): 'praise' | 'suggestion' {
  return comment.includes('?') ? 'suggestion' : 'praise';
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

export function scoreLevel(score: number): string {
  if (score <= 2) return 'low';
  if (score === 3) return 'mid';
  return 'high';
}

export function scoreClass(score: number): string {
  return `score-${scoreLevel(score)}`;
}

export function scoreColor(score: number): string {
  if (score <= 2) return 'var(--color-red)';
  if (score === 3) return 'var(--color-yellow)';
  return 'var(--color-green)';
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
