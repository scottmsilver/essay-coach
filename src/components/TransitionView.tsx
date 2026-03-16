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

  // Collect transition items for lookup
  const transitionItemMap = useMemo(() => {
    const map = new Map<string, TransitionItem>();
    let currentParagraph = 0;
    for (let i = 0; i < parsed.sentences.length; i++) {
      const s = parsed.sentences[i];
      if (s.paragraphIndex !== currentParagraph) {
        if (currentParagraph > 0) {
          const pTransition = paragraphTransitionMap.get(currentParagraph);
          if (pTransition) {
            const id = `p-${pTransition.fromParagraph}`;
            map.set(id, { id, quality: pTransition.quality, comment: pTransition.comment,
              label: `¶${pTransition.fromParagraph} → ¶${pTransition.toParagraph}` });
          }
        }
        currentParagraph = s.paragraphIndex;
      }
      if (i > 0 && parsed.sentences[i - 1].paragraphIndex === s.paragraphIndex) {
        const key = `${s.paragraphIndex}-${s.sentenceIndex - 1}-${s.sentenceIndex}`;
        const sTransition = sentenceTransitionMap.get(key);
        if (sTransition) {
          const id = `s-${key}`;
          map.set(id, { id, quality: sTransition.quality, comment: sTransition.comment,
            label: `S${sTransition.fromSentence} → S${sTransition.toSentence}` });
        }
      }
    }
    return map;
  }, [parsed.sentences, paragraphTransitionMap, sentenceTransitionMap]);

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
    let currentParagraph = 0;

    for (let i = 0; i < parsed.sentences.length; i++) {
      const s = parsed.sentences[i];

      if (s.paragraphIndex !== currentParagraph) {
        if (currentParagraph > 0) {
          const pTransition = paragraphTransitionMap.get(currentParagraph);
          if (pTransition) {
            const pKey = `p-${pTransition.fromParagraph}`;
            const isActive = activeKey === pKey;
            elements.push(
              <div
                key={`pb-${currentParagraph}`}
                data-transition-id={pKey}
                className={`transition-marker ${pTransition.quality} ${isActive ? 'active' : ''}`}
                onClick={() => handleClick(pKey)}
              >
                <span className="transition-marker-line" />
                <span className="transition-marker-label">
                  ¶{pTransition.fromParagraph} → ¶{pTransition.toParagraph}
                </span>
                <span className="transition-marker-quality">{pTransition.quality}</span>
              </div>
            );
          } else {
            elements.push(<div key={`pb-${currentParagraph}`} style={{ height: 16 }} />);
          }
        }
        currentParagraph = s.paragraphIndex;
      }

      if (i > 0 && parsed.sentences[i - 1].paragraphIndex === s.paragraphIndex) {
        const key = `${s.paragraphIndex}-${s.sentenceIndex - 1}-${s.sentenceIndex}`;
        const sTransition = sentenceTransitionMap.get(key);
        if (sTransition) {
          const sKey = `s-${key}`;
          const isActive = activeKey === sKey;
          elements.push(
            <span
              key={`st-${key}`}
              data-transition-id={sKey}
              className={`transition-dot ${sTransition.quality} ${isActive ? 'active' : ''}`}
              onClick={() => handleClick(sKey)}
              title={`${sTransition.quality}: ${sTransition.comment}`}
            />
          );
        }
      }

      elements.push(
        <span key={`s-${i}`} className="transition-sentence">
          {s.text}{' '}
        </span>
      );
    }

    return elements;
  }, [parsed.sentences, paragraphTransitionMap, sentenceTransitionMap, activeKey, handleClick]);

  const activeItem = activeKey ? transitionItemMap.get(activeKey) : null;

  return (
    <div className="transition-view">
      <div className="transition-summary">
        <div className="transition-summary-bar">
          {total > 0 && (
            <>
              <div className="transition-bar-segment smooth" style={{ width: `${(counts.smooth / total) * 100}%` }} />
              <div className="transition-bar-segment adequate" style={{ width: `${(counts.adequate / total) * 100}%` }} />
              <div className="transition-bar-segment weak" style={{ width: `${(counts.weak / total) * 100}%` }} />
              <div className="transition-bar-segment missing" style={{ width: `${(counts.missing / total) * 100}%` }} />
            </>
          )}
        </div>
        <div className="transition-summary-legend">
          {counts.smooth > 0 && <span className="legend-item"><span className="legend-dot smooth" />{counts.smooth} smooth</span>}
          {counts.adequate > 0 && <span className="legend-item"><span className="legend-dot adequate" />{counts.adequate} adequate</span>}
          {counts.weak > 0 && <span className="legend-item"><span className="legend-dot weak" />{counts.weak} weak</span>}
          {counts.missing > 0 && <span className="legend-item"><span className="legend-dot missing" />{counts.missing} missing</span>}
        </div>
        <p className="transition-summary-text">{analysis.summary}</p>
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
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
