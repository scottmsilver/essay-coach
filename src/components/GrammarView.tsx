import { useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react';
import type { GrammarAnalysis, GrammarIssue, GrammarIssueCategory } from '../types';

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
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [activeIssueKey, setActiveIssueKey] = useState<string | null>(null);
  const [commentPositions, setCommentPositions] = useState<Record<string, number>>({});
  const essayRef = useRef<HTMLDivElement>(null);

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

  // Filter issues for display (always include patterns now)
  const visibleIssues = useMemo(() => {
    if (!activeCategory) return allIssues;
    return allIssues.filter(({ category }) => category === activeCategory);
  }, [allIssues, activeCategory]);

  // Find all issue positions in the text
  const matches = useMemo((): IssueMatch[] => {
    const result: IssueMatch[] = [];
    const usedPositions = new Set<number>();

    for (const { issue, category } of visibleIssues) {
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
  }, [content, visibleIssues]);

  // Measure mark positions and lay out comments in sidebar
  useLayoutEffect(() => {
    if (!essayRef.current || matches.length === 0) return;

    const measure = () => {
      const container = essayRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const positions: Record<string, number> = {};
      let lastBottom = 0;

      for (const m of matches) {
        const markEl = container.querySelector(`[data-issue-id="${m.id}"]`);
        if (!markEl) continue;

        const markRect = markEl.getBoundingClientRect();
        const idealTop = markRect.top - containerRect.top;
        const top = Math.max(idealTop, lastBottom + 8);
        positions[m.id] = top;

        const commentEl = container.querySelector(`[data-comment-id="${m.id}"]`) as HTMLElement | null;
        const commentHeight = commentEl ? commentEl.offsetHeight : 60;
        lastBottom = top + commentHeight;
      }

      setCommentPositions(positions);
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(essayRef.current);
    return () => observer.disconnect();
  }, [matches]);

  const handleMarkClick = useCallback((id: string) => {
    setActiveIssueKey(prev => {
      const next = prev === id ? null : id;
      if (next) {
        requestAnimationFrame(() => {
          const el = essayRef.current?.querySelector(`[data-comment-id="${next}"]`);
          el?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        });
      }
      return next;
    });
  }, []);

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

  // Check if we have any mechanics issues at all
  const hasMechanics = MECHANICS_KEYS.some(key => {
    const cat = analysis[key as keyof GrammarAnalysis] as GrammarIssueCategory;
    return cat?.locations?.length > 0;
  });

  const hasPatterns = (analysis.activePassiveVoice?.passiveInstances?.length || 0) > 0
    || (analysis.modifierPlacement?.issues?.length || 0) > 0
    || (analysis.wordiness?.instances?.length || 0) > 0;

  return (
    <div className="grammar-view">
      {/* Summary bar */}
      <div className="grammar-summary">
        <div className="grammar-summary-bar">
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
        <div className="grammar-summary-legend">
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
        <p className="grammar-summary-text">{analysis.summary.overallComment}</p>
      </div>

      {/* Strength areas + priority fixes */}
      <div className="grammar-callouts">
        {analysis.summary.strengthAreas.length > 0 && (
          <div className="grammar-callout strengths">
            <strong>Strengths</strong>
            <ul>{analysis.summary.strengthAreas.map((s, i) => <li key={i}>{s}</li>)}</ul>
          </div>
        )}
        {analysis.summary.priorityFixes.length > 0 && (
          <div className="grammar-callout priorities">
            <strong>Fix First</strong>
            <ol>{analysis.summary.priorityFixes.map((s, i) => <li key={i}>{s}</li>)}</ol>
          </div>
        )}
      </div>

      {/* Category filter buttons */}
      {(hasMechanics || hasPatterns) && (
        <div className="grammar-categories">
          {hasMechanics && (
            <div className="grammar-category-group">
              <h4 className="grammar-category-heading">Mechanics</h4>
              {MECHANICS_KEYS.map(key => {
                const cat = analysis[key as keyof GrammarAnalysis] as GrammarIssueCategory;
                const count = cat?.locations?.length || 0;
                if (count === 0) return null;
                const isActive = activeCategory === key;
                return (
                  <button
                    key={key}
                    className={`grammar-category-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveCategory(isActive ? null : key)}
                  >
                    {MECHANICS_LABELS[key]}
                    <span className="grammar-category-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
          {hasPatterns && (
            <div className="grammar-category-group">
              <h4 className="grammar-category-heading">Patterns</h4>
              {Object.entries(PATTERN_LABELS).map(([key, label]) => {
                let count = 0;
                if (key === 'passiveVoice') count = analysis.activePassiveVoice?.passiveInstances?.length || 0;
                else if (key === 'modifierPlacement') count = analysis.modifierPlacement?.issues?.length || 0;
                else if (key === 'wordiness') count = analysis.wordiness?.instances?.length || 0;
                if (count === 0) return null;
                const isActive = activeCategory === key;
                return (
                  <button
                    key={key}
                    className={`grammar-category-btn ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveCategory(isActive ? null : key)}
                  >
                    {label}
                    <span className="grammar-category-count">{count}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Sentence variety */}
      {analysis.sentenceVariety && (
        <div className="grammar-sentence-variety">
          <h4>Sentence Variety</h4>
          <div className="grammar-variety-stats">
            <span>Avg length: {analysis.sentenceVariety.avgLength} words</span>
            <span>Simple: {analysis.sentenceVariety.distribution.simple}</span>
            <span>Compound: {analysis.sentenceVariety.distribution.compound}</span>
            <span>Complex: {analysis.sentenceVariety.distribution.complex}</span>
            <span>Compound-Complex: {analysis.sentenceVariety.distribution.compoundComplex}</span>
          </div>
          <p className="grammar-variety-comment">{analysis.sentenceVariety.comment}</p>
        </div>
      )}

      {/* The essay with sidebar comments */}
      <div className="annotated-essay" ref={essayRef}>
        <div className="essay-text grammar-essay">
          {essayElements}
        </div>
        {matches.length > 0 && (
          <div className="comment-sidebar">
            {matches.map((m) => {
              const isActive = activeIssueKey === m.id;
              const severityClass = m.issue.severity === 'error' ? 'suggestion' : m.issue.severity === 'warning' ? 'suggestion' : 'praise';
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
