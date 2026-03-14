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
