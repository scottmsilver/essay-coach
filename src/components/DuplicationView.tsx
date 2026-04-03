import { useState, useMemo, useCallback } from 'react';
import type { DuplicationAnalysis, DuplicationFinding } from '../types';

interface Props {
  content: string;
  analysis: DuplicationAnalysis;
}

interface MarkRange {
  start: number;
  end: number;
  findingIndex: number;
  recommendation: 'keep' | 'cut';
}

function buildMarks(content: string, findings: DuplicationFinding[]): MarkRange[] {
  const marks: MarkRange[] = [];
  for (let fi = 0; fi < findings.length; fi++) {
    for (const inst of findings[fi].instances) {
      const idx = content.indexOf(inst.quotedText);
      if (idx >= 0) {
        marks.push({
          start: idx,
          end: idx + inst.quotedText.length,
          findingIndex: fi,
          recommendation: inst.recommendation,
        });
      }
    }
  }
  // Sort by start position, no overlaps expected
  marks.sort((a, b) => a.start - b.start);
  return marks;
}

export default function DuplicationView({ content, analysis }: Props) {
  const [activeGroup, setActiveGroup] = useState<number | null>(null);

  const marks = useMemo(() => buildMarks(content, analysis.findings), [content, analysis.findings]);

  const handleMarkClick = useCallback((findingIndex: number) => {
    setActiveGroup((prev) => (prev === findingIndex ? null : findingIndex));
  }, []);

  // Build essay text with highlighted spans
  const essayElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let cursor = 0;

    for (const mark of marks) {
      if (mark.start < cursor) continue;

      // Text before this mark
      if (mark.start > cursor) {
        elements.push(<span key={`t-${cursor}`}>{content.slice(cursor, mark.start)}</span>);
      }

      const isActive = activeGroup === mark.findingIndex;
      elements.push(
        <span
          key={`m-${mark.start}`}
          className={`dup-mark ${mark.recommendation} ${isActive ? 'active' : ''}`}
          onClick={() => handleMarkClick(mark.findingIndex)}
        >
          {content.slice(mark.start, mark.end)}
        </span>,
      );

      cursor = mark.end;
    }

    if (cursor < content.length) {
      elements.push(<span key={`t-${cursor}`}>{content.slice(cursor)}</span>);
    }

    return elements;
  }, [content, marks, activeGroup, handleMarkClick]);

  // Split essay into paragraphs for rendering
  const paragraphs = useMemo(() => {
    const result: React.ReactNode[][] = [[]];
    for (const el of essayElements) {
      if (typeof el === 'string') {
        // Shouldn't happen since we wrap in spans, but handle it
        result[result.length - 1].push(el);
      } else if (el && typeof el === 'object' && 'props' in el) {
        const text = (el as React.ReactElement<{ children: string }>).props.children;
        if (typeof text === 'string' && text.includes('\n\n')) {
          const parts = text.split('\n\n');
          for (let i = 0; i < parts.length; i++) {
            if (i > 0) result.push([]);
            if (parts[i]) {
              result[result.length - 1].push(
                <span key={`p-${result.length}-${i}`}>{parts[i]}</span>,
              );
            }
          }
        } else {
          result[result.length - 1].push(el);
        }
      }
    }
    return result;
  }, [essayElements]);

  return (
    <div className="duplication-view">
      {/* Summary */}
      <div className="analysis-summary">
        <div className="analysis-summary-bar">
          {analysis.summary.totalDuplications > 0 ? (
            <>
              <div
                className="dup-bar-segment duplicated"
                style={{ width: `${(analysis.summary.totalDuplications / (analysis.summary.totalDuplications + analysis.summary.uniqueIdeas)) * 100}%` }}
              />
              <div
                className="dup-bar-segment unique"
                style={{ width: `${(analysis.summary.uniqueIdeas / (analysis.summary.totalDuplications + analysis.summary.uniqueIdeas)) * 100}%` }}
              />
            </>
          ) : (
            <div className="dup-bar-segment unique" style={{ width: '100%' }} />
          )}
        </div>
        <div className="analysis-summary-legend">
          {analysis.summary.totalDuplications > 0 && (
            <span className="legend-item">
              <span className="legend-dot" style={{ background: 'var(--color-yellow)' }} />
              {analysis.summary.totalDuplications} repeated {analysis.summary.totalDuplications === 1 ? 'idea' : 'ideas'}
            </span>
          )}
          <span className="legend-item">
            <span className="legend-dot" style={{ background: 'var(--color-green)' }} />
            {analysis.summary.uniqueIdeas} unique {analysis.summary.uniqueIdeas === 1 ? 'idea' : 'ideas'}
          </span>
        </div>
        <div className="analysis-summary-text">{analysis.summary.overallComment}</div>
      </div>

      {/* Essay + sidebar layout */}
      <div className="dup-layout">
        {/* Essay text with highlights */}
        <div className="dup-essay">
          <div className="essay-text">
            {paragraphs.map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </div>

        {/* Sidebar comments */}
        <div className="dup-sidebar">
          {analysis.findings.map((finding, fi) => (
            <div
              key={fi}
              className={`sidebar-comment ${activeGroup === fi ? 'active' : ''}`}
              style={{
                borderLeft: activeGroup === fi ? '3px solid var(--color-yellow)' : undefined,
                background: activeGroup === fi ? 'rgba(180, 83, 9, 0.04)' : undefined,
              }}
              onClick={() => handleMarkClick(fi)}
            >
              <span className={`dup-severity-tag ${finding.severity}`}>
                {finding.severity}
              </span>
              <div className="dup-finding-title">{finding.idea}</div>

              {finding.instances.map((inst, ii) => (
                <div key={ii} className="dup-instance">
                  <div className={`dup-instance-label ${inst.recommendation}`}>
                    {inst.recommendation === 'keep' ? '✓ Keep' : '✂ Cut'} (¶{inst.paragraph})
                  </div>
                  <div className={`dup-instance-quote ${inst.recommendation}`}>
                    "{inst.quotedText.length > 80 ? inst.quotedText.slice(0, 80) + '...' : inst.quotedText}"
                  </div>
                </div>
              ))}

              <div className="dup-coach-comment">{finding.comment}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
