import { useMemo, useState, useRef, useLayoutEffect, useCallback } from 'react';
import type { TransitionAnalysis, SentenceTransition, ParagraphTransition } from '../types';
import { splitSentences } from '../utils/sentenceSplitter';

interface Props {
  content: string;
  analysis: TransitionAnalysis;
}

interface ParsedSentence {
  text: string;
  paragraphIndex: number;
  sentenceIndex: number;
}

const QUALITY_LABELS: Record<string, string> = {
  smooth: 'Smooth',
  adequate: 'Adequate',
  weak: 'Weak',
  missing: 'Missing',
};

type TransitionItem = {
  id: string;
  quality: string;
  comment: string;
  label: string;
};

interface TransitionSlot {
  type: 'paragraph' | 'sentence';
  id: string;
  item: TransitionItem;
  sentenceIndex: number; // index in parsed.sentences where this transition precedes
}

/** Single traversal that identifies all transition slots in document order */
function collectTransitionSlots(
  sentences: ParsedSentence[],
  paragraphTransitionMap: Map<number, ParagraphTransition>,
  sentenceTransitionMap: Map<string, SentenceTransition>,
): TransitionSlot[] {
  const slots: TransitionSlot[] = [];
  let currentParagraph = 0;

  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i];
    if (s.paragraphIndex !== currentParagraph) {
      if (currentParagraph > 0) {
        const pTransition = paragraphTransitionMap.get(currentParagraph);
        if (pTransition) {
          const id = `p-${pTransition.fromParagraph}`;
          slots.push({
            type: 'paragraph', id, sentenceIndex: i,
            item: { id, quality: pTransition.quality, comment: pTransition.comment,
              label: `¶${pTransition.fromParagraph} → ¶${pTransition.toParagraph}` },
          });
        }
      }
      currentParagraph = s.paragraphIndex;
    }
    if (i > 0 && sentences[i - 1].paragraphIndex === s.paragraphIndex) {
      const key = `${s.paragraphIndex}-${s.sentenceIndex - 1}-${s.sentenceIndex}`;
      const sTransition = sentenceTransitionMap.get(key);
      if (sTransition) {
        const id = `s-${key}`;
        slots.push({
          type: 'sentence', id, sentenceIndex: i,
          item: { id, quality: sTransition.quality, comment: sTransition.comment,
            label: `S${sTransition.fromSentence} → S${sTransition.toSentence}` },
        });
      }
    }
  }
  return slots;
}

export default function TransitionView({ content, analysis }: Props) {
  const [activeKey, setActiveKey] = useState<string | null>(null);
  const [commentPosition, setCommentPosition] = useState<number>(0);
  const essayRef = useRef<HTMLDivElement>(null);

  const parsed = useMemo(() => {
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const effectiveParagraphs = paragraphs.length > 1
      ? paragraphs
      : content.split(/\n/).filter(p => p.trim().length > 0);

    const allSentences: ParsedSentence[] = [];
    for (let pi = 0; pi < effectiveParagraphs.length; pi++) {
      const para = effectiveParagraphs[pi].trim();
      const sentences = splitSentences(para);
      for (let si = 0; si < sentences.length; si++) {
        const s = sentences[si].trim();
        if (s.length === 0) continue;
        allSentences.push({ text: s, paragraphIndex: pi + 1, sentenceIndex: si + 1 });
      }
    }
    return { paragraphs: effectiveParagraphs, sentences: allSentences };
  }, [content]);

  const sentenceTransitionMap = useMemo(() => {
    const map = new Map<string, SentenceTransition>();
    for (const t of analysis.sentenceTransitions) {
      map.set(`${t.paragraph}-${t.fromSentence}-${t.toSentence}`, t);
    }
    return map;
  }, [analysis.sentenceTransitions]);

  const paragraphTransitionMap = useMemo(() => {
    const map = new Map<number, ParagraphTransition>();
    for (const t of analysis.paragraphTransitions) {
      map.set(t.fromParagraph, t);
    }
    return map;
  }, [analysis.paragraphTransitions]);

  const counts = useMemo(() => {
    const c = { smooth: 0, adequate: 0, weak: 0, missing: 0 };
    for (const t of analysis.sentenceTransitions) c[t.quality]++;
    for (const t of analysis.paragraphTransitions) c[t.quality]++;
    return c;
  }, [analysis]);

  const total = counts.smooth + counts.adequate + counts.weak + counts.missing;

  // Single traversal for all transition data
  const slots = useMemo(
    () => collectTransitionSlots(parsed.sentences, paragraphTransitionMap, sentenceTransitionMap),
    [parsed.sentences, paragraphTransitionMap, sentenceTransitionMap],
  );

  const transitionItemMap = useMemo(() => {
    const map = new Map<string, TransitionItem>();
    for (const slot of slots) map.set(slot.id, slot.item);
    return map;
  }, [slots]);

  // Measure the position of the active marker to place the sidebar comment
  useLayoutEffect(() => {
    if (!essayRef.current || !activeKey) return;

    const measure = () => {
      const container = essayRef.current;
      if (!container) return;
      const markerEl = container.querySelector(`[data-transition-id="${activeKey}"]`);
      if (!markerEl) return;
      const containerRect = container.getBoundingClientRect();
      const markerRect = markerEl.getBoundingClientRect();
      setCommentPosition(markerRect.top - containerRect.top);
    };

    measure();
  }, [activeKey]);

  const handleClick = useCallback((id: string) => {
    setActiveKey(prev => prev === id ? null : id);
  }, []);

  const essayElements = useMemo(() => {
    const elements: React.ReactNode[] = [];
    // Index slots by the sentence they precede
    const slotsBefore = new Map<number, TransitionSlot[]>();
    for (const slot of slots) {
      const arr = slotsBefore.get(slot.sentenceIndex) ?? [];
      arr.push(slot);
      slotsBefore.set(slot.sentenceIndex, arr);
    }

    let lastParagraph = 0;
    for (let i = 0; i < parsed.sentences.length; i++) {
      const s = parsed.sentences[i];
      // Paragraph gap spacer (when no paragraph transition exists)
      if (s.paragraphIndex !== lastParagraph) {
        if (lastParagraph > 0 && !slotsBefore.get(i)?.some(sl => sl.type === 'paragraph')) {
          elements.push(<div key={`pb-${lastParagraph}`} style={{ height: 16 }} />);
        }
        lastParagraph = s.paragraphIndex;
      }

      const preceding = slotsBefore.get(i);
      if (preceding) {
        for (const slot of preceding) {
          const isActive = activeKey === slot.id;
          if (slot.type === 'paragraph') {
            elements.push(
              <div
                key={`pb-${slot.id}`}
                data-transition-id={slot.id}
                className={`transition-marker ${slot.item.quality} ${isActive ? 'active' : ''}`}
                onClick={() => handleClick(slot.id)}
              >
                <span className="transition-marker-line" />
                <span className="transition-marker-label">{slot.item.label}</span>
                <span className="transition-marker-quality">{slot.item.quality}</span>
              </div>
            );
          } else {
            elements.push(
              <span
                key={`st-${slot.id}`}
                data-transition-id={slot.id}
                className={`transition-dot ${slot.item.quality} ${isActive ? 'active' : ''}`}
                onClick={() => handleClick(slot.id)}
                title={`${slot.item.quality}: ${slot.item.comment}`}
              />
            );
          }
        }
      }

      elements.push(
        <span key={`s-${i}`} className="transition-sentence">
          {s.text}{' '}
        </span>
      );
    }

    return elements;
  }, [parsed.sentences, slots, activeKey, handleClick]);

  // Issue IDs (non-smooth) in document order for "Next Issue" navigation
  const issueIds = useMemo(
    () => slots.filter(s => s.item.quality !== 'smooth').map(s => s.id),
    [slots],
  );

  const handleNextIssue = useCallback(() => {
    if (issueIds.length === 0) return;
    const currentIndex = activeKey ? issueIds.indexOf(activeKey) : -1;
    const nextIndex = (currentIndex + 1) % issueIds.length;
    const nextId = issueIds[nextIndex];
    setActiveKey(nextId);
    requestAnimationFrame(() => {
      const el = essayRef.current?.querySelector(`[data-transition-id="${nextId}"]`);
      el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }, [issueIds, activeKey]);

  const activeItem = activeKey ? transitionItemMap.get(activeKey) : null;

  return (
    <div className="transition-view">
      <div className="analysis-summary">
        <div className="analysis-summary-bar">
          {total > 0 && (
            <>
              <div className="transition-bar-segment smooth" style={{ width: `${(counts.smooth / total) * 100}%` }} />
              <div className="transition-bar-segment adequate" style={{ width: `${(counts.adequate / total) * 100}%` }} />
              <div className="transition-bar-segment weak" style={{ width: `${(counts.weak / total) * 100}%` }} />
              <div className="transition-bar-segment missing" style={{ width: `${(counts.missing / total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="analysis-summary-legend">
          {counts.smooth > 0 && <span className="legend-item"><span className="legend-dot smooth" />{counts.smooth} smooth</span>}
          {counts.adequate > 0 && <span className="legend-item"><span className="legend-dot adequate" />{counts.adequate} adequate</span>}
          {counts.weak > 0 && <span className="legend-item"><span className="legend-dot weak" />{counts.weak} weak</span>}
          {counts.missing > 0 && <span className="legend-item"><span className="legend-dot missing" />{counts.missing} missing</span>}
        </div>
        <p className="analysis-summary-text">{analysis.summary}</p>
      </div>

      <div className="annotated-essay" ref={essayRef}>
        <div className="essay-text transition-essay">
          {essayElements}
        </div>
        <div className="comment-sidebar">
          {activeItem && (
            <div
              className={`sidebar-comment ${activeItem.quality === 'smooth' ? 'praise' : 'suggestion'} active`}
              style={{ top: commentPosition }}
              onClick={() => handleClick(activeItem.id)}
            >
              <span className="sidebar-comment-trait">
                {QUALITY_LABELS[activeItem.quality]} — {activeItem.label}
              </span>
              <span className="sidebar-comment-text">{activeItem.comment}</span>
              {issueIds.length > 0 && (
                <button
                  className="next-issue-btn"
                  onClick={(e) => { e.stopPropagation(); handleNextIssue(); }}
                >
                  Next Issue {issueIds.includes(activeItem.id) ? `(${issueIds.indexOf(activeItem.id) + 1}/${issueIds.length})` : ''}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
