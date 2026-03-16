import { useMemo, useRef } from 'react';
import type { GrammarAnalysis, GrammarIssue, GrammarIssueCategory } from '../types';
import { useCommentLayout } from '../hooks/useCommentLayout';
import { useActiveMarker } from '../hooks/useActiveMarker';

interface Props {
  content: string;
  analysis: GrammarAnalysis;
}

// Human-readable labels for each mechanics category
const MECHANICS_LABELS: Record<string, string> = {
  commaSplices: 'Comma Splices',
  runOnSentences: 'Run-on Sentences',
  fragments: 'Fragments',
  subjectVerbAgreement: 'Subject-Verb Agreement',
  pronounReference: 'Pronoun Reference',
  verbTenseConsistency: 'Verb Tense Consistency',
  parallelStructure: 'Parallel Structure',
  punctuationErrors: 'Punctuation Errors',
  missingCommas: 'Missing Commas',
};

const PATTERN_LABELS: Record<string, string> = {
  passiveVoice: 'Passive Voice',
  modifierPlacement: 'Modifier Placement',
  wordiness: 'Wordiness',
};

const ALL_LABELS: Record<string, string> = { ...MECHANICS_LABELS, ...PATTERN_LABELS };

const MECHANICS_KEYS = Object.keys(MECHANICS_LABELS) as (keyof typeof MECHANICS_LABELS)[];

type IssueMatch = { start: number; end: number; issue: GrammarIssue; category: string; id: string };

export default function GrammarView({ content, analysis }: Props) {
  const essayRef = useRef<HTMLDivElement>(null);
  const [activeIssueKey, handleMarkClick] = useActiveMarker(essayRef);

  // Collect all issues with their category for rendering
  const allIssues = useMemo(() => {
    const issues: { issue: GrammarIssue; category: string }[] = [];
    for (const key of MECHANICS_KEYS) {
      const cat = analysis[key as keyof GrammarAnalysis] as GrammarIssueCategory;
      if (!cat?.locations) continue;
      for (const loc of cat.locations) {
        issues.push({ issue: loc, category: key });
      }
    }
    for (const inst of analysis.activePassiveVoice?.passiveInstances || []) {
      issues.push({ issue: { sentence: '', quotedText: inst.quotedText, comment: inst.comment, severity: 'pattern' }, category: 'passiveVoice' });
    }
    for (const inst of analysis.modifierPlacement?.issues || []) {
      issues.push({ issue: { sentence: '', quotedText: inst.quotedText, comment: inst.comment, severity: 'pattern' }, category: 'modifierPlacement' });
    }
    for (const inst of analysis.wordiness?.instances || []) {
      issues.push({ issue: { sentence: '', quotedText: inst.quotedText, comment: inst.comment, severity: 'pattern' }, category: 'wordiness' });
    }
    return issues;
  }, [analysis]);

  // Count by severity
  const counts = useMemo(() => {
    const c = { error: 0, warning: 0, pattern: 0 };
    for (const { issue } of allIssues) {
      c[issue.severity]++;
    }
    return c;
  }, [allIssues]);

  const total = counts.error + counts.warning + counts.pattern;

  // Find all issue positions in the text
  const matches = useMemo((): IssueMatch[] => {
    const result: IssueMatch[] = [];
    const usedPositions = new Set<number>();

    for (const { issue, category } of allIssues) {
      const needle = issue.quotedText;
      if (!needle) continue;

      const candidates: number[] = [];
      let searchFrom = 0;
      while (searchFrom < content.length) {
        const idx = content.indexOf(needle, searchFrom);
        if (idx === -1) break;
        candidates.push(idx);
        searchFrom = idx + 1;
      }

      let bestIdx = -1;

      if (candidates.length === 1) {
        bestIdx = candidates[0];
      } else if (candidates.length > 1 && issue.sentence) {
        const sentenceIdx = content.indexOf(issue.sentence);
        if (sentenceIdx >= 0) {
          for (const idx of candidates) {
            if (idx >= sentenceIdx && idx + needle.length <= sentenceIdx + issue.sentence.length && !usedPositions.has(idx)) {
              bestIdx = idx;
              break;
            }
          }
        }
      }

      if (bestIdx === -1) {
        for (const idx of candidates) {
          if (!usedPositions.has(idx)) {
            bestIdx = idx;
            break;
          }
        }
      }

      if (bestIdx >= 0) {
        const id = `${category}-${bestIdx}`;
        result.push({ start: bestIdx, end: bestIdx + needle.length, issue, category, id });
        usedPositions.add(bestIdx);
      }
    }

    result.sort((a, b) => a.start - b.start);
    return result;
  }, [content, allIssues]);

  const commentPositions = useCommentLayout(essayRef, matches, 'data-issue-id');

  // Build essay elements
  const essayElements = useMemo(() => {
    if (matches.length === 0) {
      return [<span key="full">{content}</span>];
    }

    const elements: React.ReactNode[] = [];
    let cursor = 0;

    for (let i = 0; i < matches.length; i++) {
      const m = matches[i];
      if (m.start < cursor) continue;

      if (m.start > cursor) {
        elements.push(<span key={`t-${cursor}`}>{content.slice(cursor, m.start)}</span>);
      }

      const isActive = activeIssueKey === m.id;
      elements.push(
        <span
          key={`m-${i}`}
          data-issue-id={m.id}
          className={`grammar-underline ${m.issue.severity} ${isActive ? 'active' : ''}`}
          onClick={() => handleMarkClick(m.id)}
          title={ALL_LABELS[m.category] || m.category}
        >
          {content.slice(m.start, m.end)}
        </span>
      );

      cursor = m.end;
    }

    if (cursor < content.length) {
      elements.push(<span key={`t-${cursor}`}>{content.slice(cursor)}</span>);
    }

    return elements;
  }, [content, matches, activeIssueKey, handleMarkClick]);

  return (
    <div className="grammar-view">
      {/* Summary bar */}
      <div className="analysis-summary">
        <div className="analysis-summary-bar">
          {total > 0 ? (
            <>
              {counts.error > 0 && <div className="grammar-bar-segment error" style={{ width: `${(counts.error / total) * 100}%` }} />}
              {counts.warning > 0 && <div className="grammar-bar-segment warning" style={{ width: `${(counts.warning / total) * 100}%` }} />}
              {counts.pattern > 0 && <div className="grammar-bar-segment pattern" style={{ width: `${(counts.pattern / total) * 100}%` }} />}
            </>
          ) : (
            <div className="grammar-bar-segment clean" style={{ width: '100%' }} />
          )}
        </div>
        <div className="analysis-summary-legend">
          {counts.error > 0 && <span className="legend-item"><span className="legend-dot error" />{counts.error} error{counts.error !== 1 ? 's' : ''}</span>}
          {counts.warning > 0 && <span className="legend-item"><span className="legend-dot warning" />{counts.warning} warning{counts.warning !== 1 ? 's' : ''}</span>}
          {counts.pattern > 0 && <span className="legend-item"><span className="legend-dot pattern" />{counts.pattern} pattern{counts.pattern !== 1 ? 's' : ''}</span>}
          {total === 0 && <span className="legend-item"><span className="legend-dot clean" />No issues found</span>}
        </div>
        {analysis.activePassiveVoice && (
          <p className="grammar-passive-ratio">
            {analysis.activePassiveVoice.activeCount} active, {analysis.activePassiveVoice.passiveCount} passive
            {analysis.activePassiveVoice.activeCount + analysis.activePassiveVoice.passiveCount > 0 &&
              ` (${Math.round((analysis.activePassiveVoice.passiveCount / (analysis.activePassiveVoice.activeCount + analysis.activePassiveVoice.passiveCount)) * 100)}% passive)`
            }
          </p>
        )}
        <p className="analysis-summary-text">{analysis.summary.overallComment}</p>
      </div>


      {/* The essay with sidebar comments */}
      <div className="annotated-essay" ref={essayRef}>
        <div className="essay-text grammar-essay">
          {essayElements}
        </div>
        {matches.length > 0 && (
          <div className="comment-sidebar">
            {matches.map((m) => {
              const isActive = activeIssueKey === m.id;
              const severityClass = m.issue.severity === 'pattern' ? 'praise' : 'suggestion';
              return (
                <div
                  key={m.id}
                  data-comment-id={m.id}
                  className={`sidebar-comment ${severityClass} ${isActive ? 'active' : ''}`}
                  style={{ top: commentPositions[m.id] ?? 0 }}
                  onClick={() => handleMarkClick(m.id)}
                >
                  <span className="sidebar-comment-trait">{ALL_LABELS[m.category] || m.category}</span>
                  <span className="sidebar-comment-text">{m.issue.comment}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
