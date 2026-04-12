import type { ReactNode } from 'react';

export interface BarSegment {
  color: string;
  proportion: number; // 0-1
  label: string;
  count: number;
}

interface AnalysisSummaryCardProps {
  segments: BarSegment[];
  summaryText: string;
  children?: ReactNode; // extra content between legend and summary text
}

/**
 * Shared summary card used at the top of every analysis view.
 * Shows a colored proportion bar, legend dots with counts, and summary text.
 * Matches the existing .analysis-summary CSS pattern used by Grammar, Transitions,
 * Prompt, and Duplication views.
 */
export default function AnalysisSummaryCard({ segments, summaryText, children }: AnalysisSummaryCardProps) {
  const hasData = segments.some(s => s.count > 0);

  return (
    <div className="analysis-summary">
      <div className="analysis-summary-bar">
        {hasData ? (
          segments.filter(s => s.proportion > 0).map((s, i) => (
            <div
              key={i}
              className="criteria-bar-segment"
              style={{ width: `${s.proportion * 100}%`, background: s.color }}
            />
          ))
        ) : (
          <div className="criteria-bar-segment" style={{ width: '100%', background: 'var(--color-green)' }} />
        )}
      </div>
      <div className="analysis-summary-legend">
        {segments.filter(s => s.count > 0).map((s, i) => (
          <span key={i} className="legend-item">
            <span className="legend-dot" style={{ background: s.color }} />
            {s.count} {s.label}
          </span>
        ))}
      </div>
      {children}
      <p className="analysis-summary-text">{summaryText}</p>
    </div>
  );
}
