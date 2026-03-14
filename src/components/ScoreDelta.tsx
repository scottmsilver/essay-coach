interface Props { previous: number; current: number; }

export default function ScoreDelta({ previous, current }: Props) {
  const delta = current - previous;
  const className = delta > 0 ? 'positive' : delta < 0 ? 'negative' : 'neutral';
  const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : '';
  return <span className={`score-delta ${className}`}>{previous} → {current} {arrow}</span>;
}
