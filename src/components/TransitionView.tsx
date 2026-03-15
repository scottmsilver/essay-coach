import { useMemo, useState } from 'react';
import type { TransitionAnalysis, SentenceTransition, ParagraphTransition } from '../types';

interface Props {
  content: string;
  analysis: TransitionAnalysis;
}

interface ParsedSentence {
  text: string;
  paragraphIndex: number;
  sentenceIndex: number;
}

export default function TransitionView({ content, analysis }: Props) {
  const [activeTransition, setActiveTransition] = useState<SentenceTransition | ParagraphTransition | null>(null);

  // Parse content into paragraphs and sentences matching the backend's splitting
  const parsed = useMemo(() => {
    const paragraphs = content.split(/\n\s*\n/).filter(p => p.trim().length > 0);
    const effectiveParagraphs = paragraphs.length > 1
      ? paragraphs
      : content.split(/\n/).filter(p => p.trim().length > 0);

    const allSentences: ParsedSentence[] = [];

    for (let pi = 0; pi < effectiveParagraphs.length; pi++) {
      const para = effectiveParagraphs[pi].trim();
      const sentences = para.match(/[^.!?]+[.!?]+(?:\s|$)|[^.!?]+$/g) || [para];

      for (let si = 0; si < sentences.length; si++) {
        const s = sentences[si].trim();
        if (s.length === 0) continue;
        allSentences.push({ text: s, paragraphIndex: pi + 1, sentenceIndex: si + 1 });
      }
    }

    return { paragraphs: effectiveParagraphs, sentences: allSentences };
  }, [content]);

  // Build a lookup for transition between sentence pairs
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

  // Count transitions by quality
  const counts = useMemo(() => {
    const c = { smooth: 0, adequate: 0, weak: 0, missing: 0 };
    for (const t of analysis.sentenceTransitions) c[t.quality]++;
    for (const t of analysis.paragraphTransitions) c[t.quality]++;
    return c;
  }, [analysis]);

  const total = counts.smooth + counts.adequate + counts.weak + counts.missing;

  // Render the essay with transition markers between sentences
  const elements: React.ReactNode[] = [];
  let currentParagraph = 0;

  for (let i = 0; i < parsed.sentences.length; i++) {
    const s = parsed.sentences[i];

    // Paragraph break marker
    if (s.paragraphIndex !== currentParagraph) {
      if (currentParagraph > 0) {
        const pTransition = paragraphTransitionMap.get(currentParagraph);
        if (pTransition) {
          const isActive = activeTransition === pTransition;
          elements.push(
            <div
              key={`pb-${currentParagraph}`}
              className={`transition-marker paragraph-marker ${pTransition.quality} ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTransition(isActive ? null : pTransition)}
            >
              <span className="transition-marker-line" />
              <span className="transition-marker-label">
                ¶{pTransition.fromParagraph} → ¶{pTransition.toParagraph}
              </span>
              <span className="transition-marker-quality">{pTransition.quality}</span>
            </div>
          );
          if (isActive) {
            elements.push(
              <div key={`pb-comment-${currentParagraph}`} className={`transition-comment ${pTransition.quality}`}>
                {pTransition.comment}
              </div>
            );
          }
        }
      }
      currentParagraph = s.paragraphIndex;
    }

    // Sentence transition marker (between consecutive sentences in same paragraph)
    if (i > 0 && parsed.sentences[i - 1].paragraphIndex === s.paragraphIndex) {
      const key = `${s.paragraphIndex}-${s.sentenceIndex - 1}-${s.sentenceIndex}`;
      const sTransition = sentenceTransitionMap.get(key);
      if (sTransition) {
        const isActive = activeTransition === sTransition;
        elements.push(
          <span
            key={`st-${key}`}
            className={`transition-dot ${sTransition.quality} ${isActive ? 'active' : ''}`}
            onClick={() => setActiveTransition(isActive ? null : sTransition)}
            title={`${sTransition.quality}: ${sTransition.comment}`}
          />
        );
        if (isActive) {
          elements.push(
            <div key={`st-comment-${key}`} className={`transition-comment inline ${sTransition.quality}`}>
              {sTransition.comment}
            </div>
          );
        }
      }
    }

    // The sentence itself
    elements.push(
      <span key={`s-${i}`} className="transition-sentence">
        {s.text}{' '}
      </span>
    );
  }

  return (
    <div className="transition-view">
      {/* Summary bar */}
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

      {/* The essay with heatmap markers */}
      <div className="transition-essay">
        {elements}
      </div>
    </div>
  );
}
