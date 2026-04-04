import { useMemo, useRef } from 'react';
import type { DuplicationAnalysis, DuplicationFinding } from '../types';
import { useActiveMarker } from '../hooks/useActiveMarker';
import { useCommentLayout } from '../hooks/useCommentLayout';

interface Props {
  content: string;
  analysis: DuplicationAnalysis;
}

interface MarkRange {
  start: number;
  end: number;
  id: string;
  findingIndex: number;
  recommendation: 'keep' | 'cut';
}

function buildMarks(content: string, findings: DuplicationFinding[]): MarkRange[] {
  const marks: MarkRange[] = [];
  for (let fi = 0; fi < findings.length; fi++) {
    for (let ii = 0; ii < findings[fi].instances.length; ii++) {
      const inst = findings[fi].instances[ii];
      const idx = content.indexOf(inst.quotedText);
      if (idx >= 0) {
        marks.push({
          start: idx,
          end: idx + inst.quotedText.length,
          id: `dup-${fi}-${ii}`,
          findingIndex: fi,
          recommendation: inst.recommendation,
        });
      }
    }
  }
  marks.sort((a, b) => a.start - b.start);
  return marks;
}

export default function DuplicationView({ content, analysis }: Props) {
  const essayRef = useRef<HTMLDivElement>(null);
  const [activeId, handleMarkClick] = useActiveMarker(essayRef);

  const marks = useMemo(() => buildMarks(content, analysis.findings), [content, analysis.findings]);

  // Which finding is active (derived from activeId)
  const activeFinding = useMemo(() => {
    if (!activeId) return null;
    const mark = marks.find(m => m.id === activeId);
    return mark ? mark.findingIndex : null;
  }, [activeId, marks]);

  // Build highlighted essay elements using the same cursor-walk pattern as GrammarView
  const essayElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    let cursor = 0;

    for (const mark of marks) {
      if (mark.start < cursor) continue;

      if (mark.start > cursor) {
        const text = content.slice(cursor, mark.start);
        // Convert double newlines to <br/> pairs (same approach as GrammarView)
        const parts = text.split('\n\n');
        for (let i = 0; i < parts.length; i++) {
          if (i > 0) elements.push(<br key={`br1-${cursor}-${i}`} />, <br key={`br2-${cursor}-${i}`} />);
          if (parts[i]) elements.push(<span key={`t-${cursor}-${i}`}>{parts[i]}</span>);
        }
      }

      const isActive = activeFinding === mark.findingIndex;
      elements.push(
        <span
          key={mark.id}
          data-dup-id={mark.id}
          className={`dup-mark ${mark.recommendation} ${isActive ? 'active' : ''}`}
          onClick={() => handleMarkClick(mark.id)}
        >
          {content.slice(mark.start, mark.end)}
        </span>,
      );

      cursor = mark.end;
    }

    if (cursor < content.length) {
      const text = content.slice(cursor);
      const parts = text.split('\n\n');
      for (let i = 0; i < parts.length; i++) {
        if (i > 0) elements.push(<br key={`bre1-${cursor}-${i}`} />, <br key={`bre2-${cursor}-${i}`} />);
        if (parts[i]) elements.push(<span key={`te-${cursor}-${i}`}>{parts[i]}</span>);
      }
    }

    return elements;
  }, [content, marks, activeFinding, handleMarkClick]);

  const commentPositions = useCommentLayout(essayRef, marks, 'data-dup-id', activeId);

  return (
    <div className="duplication-view">
      {/* Summary */}
      <div className="analysis-summary">
        <div className="analysis-summary-bar">
          {analysis.summary.totalDuplications > 0 ? (
            <>
              <div className="dup-bar-segment duplicated"
                style={{ width: `${(analysis.summary.totalDuplications / (analysis.summary.totalDuplications + analysis.summary.uniqueIdeas)) * 100}%` }} />
              <div className="dup-bar-segment unique"
                style={{ width: `${(analysis.summary.uniqueIdeas / (analysis.summary.totalDuplications + analysis.summary.uniqueIdeas)) * 100}%` }} />
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

      {/* Essay + sidebar */}
      <div className="dup-layout">
        <div className="dup-essay" ref={essayRef}>
          <div className="essay-text">{essayElements}</div>
        </div>

        <div className="dup-sidebar">
          {analysis.findings.map((finding, fi) => {
            const isActive = activeFinding === fi;
            // Position from useCommentLayout (first mark for this finding)
            const firstMark = marks.find(m => m.findingIndex === fi);
            const pos = firstMark ? commentPositions[firstMark.id] : undefined;

            return (
              <div
                key={fi}
                className={`sidebar-comment ${isActive ? 'active' : ''}`}
                style={{
                  ...(pos != null ? { position: 'absolute' as const, top: pos } : {}),
                  borderLeft: isActive ? '3px solid var(--color-yellow)' : '3px solid rgba(180, 83, 9, 0.3)',
                  background: isActive ? 'rgba(180, 83, 9, 0.04)' : undefined,
                }}
                onClick={() => {
                  if (firstMark) handleMarkClick(firstMark.id);
                }}
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
            );
          })}
        </div>
      </div>
    </div>
  );
}
