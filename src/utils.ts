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
