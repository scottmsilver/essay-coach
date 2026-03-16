import { useMemo, useState, useCallback, useRef, useLayoutEffect } from 'react';
import type { Annotation, TraitKey } from '../types';

export interface TraitAnnotation extends Annotation {
  traitKey: TraitKey;
  traitLabel: string;
}

interface Props {
  content: string;
  annotations: TraitAnnotation[];
  onChange?: (content: string) => void;
  readOnly?: boolean;
  activeTrait?: TraitKey | null;
}

interface AnnotationMarker {
  start: number;
  end: number;
  annotation: TraitAnnotation;
  id: string;
  kind: 'praise' | 'suggestion';
}

// Annotations that ask questions are suggestions; pure statements of what works are praise
function classifyAnnotation(comment: string): 'praise' | 'suggestion' {
  return comment.includes('?') ? 'suggestion' : 'praise';
}

export default function AnnotatedEssay({ content, annotations, onChange, readOnly = true, activeTrait }: Props) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const [commentPositions, setCommentPositions] = useState<Record<string, number>>({});
  const essayRef = useRef<HTMLDivElement>(null);

  // Filter annotations by active trait if set
  const filteredAnnotations = useMemo(() => {
    if (!activeTrait) return annotations;
    return annotations.filter(a => a.traitKey === activeTrait);
  }, [annotations, activeTrait]);

  // Find all annotation positions in the escaped content
  const markers = useMemo(() => {
    const escaped = escapeHtml(content);
    const found: AnnotationMarker[] = [];
    const sorted = [...filteredAnnotations].sort((a, b) => b.quotedText.length - a.quotedText.length);
    const used = new Set<number>();

    for (const ann of sorted) {
      const needle = escapeHtml(ann.quotedText);
      const idx = escaped.indexOf(needle);
      if (idx === -1) continue;

      let overlaps = false;
      for (let i = idx; i < idx + needle.length; i++) {
        if (used.has(i)) { overlaps = true; break; }
      }
      if (overlaps) continue;

      for (let i = idx; i < idx + needle.length; i++) used.add(i);
      const id = `ann-${idx}`;
      found.push({ start: idx, end: idx + needle.length, annotation: ann, id, kind: classifyAnnotation(ann.comment) });
    }

    return found.sort((a, b) => a.start - b.start);
  }, [content, filteredAnnotations]);

  // Measure mark positions and lay out comments on the right
  useLayoutEffect(() => {
    if (!essayRef.current || markers.length === 0) return;

    const measure = () => {
      const container = essayRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const positions: Record<string, number> = {};
      let lastBottom = 0;

      for (const m of markers) {
        const markEl = container.querySelector(`[data-ann-id="${m.id}"]`);
        if (!markEl) continue;

        const markRect = markEl.getBoundingClientRect();
        const idealTop = markRect.top - containerRect.top;
        // Push down if would overlap the previous comment
        const top = Math.max(idealTop, lastBottom + 8);
        positions[m.id] = top;

        // Estimate comment height (will be refined by the browser, but good enough for layout)
        const commentEl = container.querySelector(`[data-comment-id="${m.id}"]`) as HTMLElement | null;
        const commentHeight = commentEl ? commentEl.offsetHeight : 60;
        lastBottom = top + commentHeight;
      }

      setCommentPositions(positions);
    };

    // Measure after render
    measure();
    // Re-measure on resize
    const observer = new ResizeObserver(measure);
    observer.observe(essayRef.current);
    return () => observer.disconnect();
  }, [markers]);

  const handleMarkClick = useCallback((id: string) => {
    setActiveId(prev => {
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

  if (!readOnly) {
    return (
      <div>
        <textarea className="essay-editor" value={content} onChange={(e) => onChange?.(e.target.value)} />
      </div>
    );
  }

  // Build segments: alternating plain text and annotated spans
  const escaped = escapeHtml(content);
  const segments: React.ReactNode[] = [];
  let pos = 0;

  for (let i = 0; i < markers.length; i++) {
    const m = markers[i];
    if (m.start > pos) {
      segments.push(
        <span key={`t${i}`} dangerouslySetInnerHTML={{ __html: escaped.slice(pos, m.start).replace(/\n/g, '<br/>') }} />
      );
    }
    const isActive = activeId === m.id;
    segments.push(
      <mark
        key={`m${i}`}
        data-ann-id={m.id}
        className={`annotation-mark ${m.kind} ${isActive ? 'selected' : ''}`}
        onClick={() => handleMarkClick(m.id)}
        role="button"
        tabIndex={0}
      >
        <span dangerouslySetInnerHTML={{ __html: escaped.slice(m.start, m.end).replace(/\n/g, '<br/>') }} />
      </mark>
    );
    pos = m.end;
  }
  if (pos < escaped.length) {
    segments.push(
      <span key="end" dangerouslySetInnerHTML={{ __html: escaped.slice(pos).replace(/\n/g, '<br/>') }} />
    );
  }

  return (
    <div className="annotated-essay" ref={essayRef}>
      <div className="essay-text">
        {segments}
      </div>
      {markers.length > 0 && (
        <div className="comment-sidebar">
          {markers.map((m) => (
            <div
              key={m.id}
              data-comment-id={m.id}
              className={`sidebar-comment ${m.kind} ${activeId === m.id ? 'active' : ''}`}
              style={{ top: commentPositions[m.id] ?? 0 }}
              onClick={() => handleMarkClick(m.id)}
            >
              <span className="sidebar-comment-trait">{m.annotation.traitLabel}</span>
              <span className="sidebar-comment-text">{m.annotation.comment}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
