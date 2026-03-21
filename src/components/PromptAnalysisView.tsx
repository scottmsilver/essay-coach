import { useState, useMemo } from 'react';
import type { PromptAnalysis, MatrixCell } from '../types';

interface Props {
  analysis: PromptAnalysis;
}

const STATUS_ICON: Record<string, string> = {
  filled: '\u25CF',   // ●
  partial: '\u25D0',  // ◐
  empty: '\u25CB',    // ○
};

function CellDetail({ cell }: { cell: MatrixCell }) {
  return (
    <div className="prompt-cell-detail">
      {cell.evidence.length > 0 && (
        <div className="prompt-cell-evidence">
          {cell.evidence.map((quote, i) => (
            <blockquote key={i} className="prompt-evidence-quote">{quote}</blockquote>
          ))}
        </div>
      )}
      <p className="prompt-cell-comment">{cell.comment}</p>
    </div>
  );
}

function QuestionRow({ question }: { question: { questionText: string; addressed: boolean; evidence: string; comment: string } }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className={`prompt-question-row ${expanded ? 'expanded' : ''}`}
      onClick={() => setExpanded(!expanded)}
    >
      <div className="prompt-question-header">
        <span className="prompt-question-text">{question.questionText}</span>
        <span className={`prompt-coverage-pill ${question.addressed ? 'filled' : 'empty'}`}>
          {question.addressed ? 'Answered' : 'Not Answered'}
        </span>
      </div>
      {expanded && (
        <div className="prompt-cell-detail">
          {question.evidence && (
            <blockquote className="prompt-evidence-quote">{question.evidence}</blockquote>
          )}
          <p className="prompt-cell-comment">{question.comment}</p>
        </div>
      )}
    </div>
  );
}

export default function PromptAnalysisView({ analysis }: Props) {
  const { matrix, questions, summary } = analysis;
  const isGrid = matrix.columns.length > 1;

  const [expandedCell, setExpandedCell] = useState<string | null>(null);

  const toggleCell = (key: string) => {
    setExpandedCell(prev => prev === key ? null : key);
  };

  // Summary bar proportions
  const barSegments = useMemo(() => {
    const total = summary.totalCells;
    if (total === 0) return { filled: 100, partial: 0, empty: 0 };
    return {
      filled: (summary.filledCells / total) * 100,
      partial: (summary.partialCells / total) * 100,
      empty: (summary.emptyCells / total) * 100,
    };
  }, [summary]);

  return (
    <div className="prompt-view">
      {/* Summary bar */}
      <div className="analysis-summary">
        <div className="analysis-summary-bar">
          {summary.totalCells > 0 ? (
            <>
              {barSegments.filled > 0 && <div className="prompt-bar-segment filled" style={{ width: `${barSegments.filled}%` }} />}
              {barSegments.partial > 0 && <div className="prompt-bar-segment partial" style={{ width: `${barSegments.partial}%` }} />}
              {barSegments.empty > 0 && <div className="prompt-bar-segment empty" style={{ width: `${barSegments.empty}%` }} />}
            </>
          ) : (
            <div className="prompt-bar-segment filled" style={{ width: '100%' }} />
          )}
        </div>
        <div className="analysis-summary-legend">
          {summary.filledCells > 0 && <span className="legend-item"><span className="legend-dot filled" />{summary.filledCells} filled</span>}
          {summary.partialCells > 0 && <span className="legend-item"><span className="legend-dot partial" />{summary.partialCells} partial</span>}
          {summary.emptyCells > 0 && <span className="legend-item"><span className="legend-dot empty" />{summary.emptyCells} empty</span>}
        </div>
        <p className="analysis-summary-text">{summary.overallComment}</p>
      </div>

      {/* Matrix description */}
      <p className="prompt-matrix-description">{matrix.description}</p>

      {/* Grid mode */}
      {isGrid ? (
        <div className="prompt-matrix-grid">
          <table className="prompt-matrix-table">
            <thead>
              <tr>
                <th className="prompt-matrix-corner">{matrix.rowLabel}</th>
                {matrix.columns.map((col, ci) => (
                  <th key={ci} className="prompt-matrix-col-header">{col}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matrix.rows.map((row, ri) => {
                const expandedInRow = matrix.columns
                  .map((_, ci) => `${ri}-${ci}`)
                  .find(key => key === expandedCell);
                const expandedCi = expandedInRow ? parseInt(expandedInRow.split('-')[1]) : -1;
                const cell = expandedCi >= 0 ? row.cells[expandedCi] : null;

                return [
                  <tr key={`row-${ri}`}>
                    <td className="prompt-matrix-row-label">{row.label}</td>
                    {row.cells.map((c, ci) => {
                      const key = `${ri}-${ci}`;
                      const isActive = expandedCell === key;
                      return (
                        <td
                          key={ci}
                          className={`prompt-matrix-cell ${c.status} ${isActive ? 'active' : ''}`}
                          onClick={() => toggleCell(key)}
                        >
                          <span className="prompt-cell-icon">{STATUS_ICON[c.status]}</span>
                          <span className="prompt-cell-status-label">{c.status}</span>
                        </td>
                      );
                    })}
                  </tr>,
                  expandedInRow && cell && (
                    <tr key={`detail-${ri}`} className="prompt-matrix-detail-row">
                      <td colSpan={matrix.columns.length + 1}>
                        <CellDetail cell={cell} />
                      </td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>
      ) : (
        /* List mode (flat / single-column) */
        <div className="prompt-requirement-list">
          {matrix.rows.map((row, ri) => {
            const cell = row.cells[0];
            if (!cell) return null;
            const key = `${ri}-0`;
            const isExpanded = expandedCell === key;

            return (
              <div
                key={ri}
                className={`prompt-requirement-row ${cell.status} ${isExpanded ? 'expanded' : ''}`}
                onClick={() => toggleCell(key)}
              >
                <div className="prompt-requirement-header">
                  <span className="prompt-requirement-label">{row.label}</span>
                  <span className={`prompt-coverage-pill ${cell.status}`}>
                    {STATUS_ICON[cell.status]} {cell.status.charAt(0).toUpperCase() + cell.status.slice(1)}
                  </span>
                </div>
                {isExpanded && <CellDetail cell={cell} />}
              </div>
            );
          })}
        </div>
      )}

      {/* Questions section */}
      {questions.length > 0 && (
        <div className="prompt-questions-section">
          <h3 className="prompt-section-heading">Questions</h3>
          {questions.map((q, i) => (
            <QuestionRow key={i} question={q} />
          ))}
        </div>
      )}
    </div>
  );
}
