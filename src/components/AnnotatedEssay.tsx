import { useMemo, useRef } from 'react';
import type { TraitKey, TraitAnnotation } from '../types';
import type { CriteriaAnnotation } from '../utils';
import { useCommentLayout } from '../hooks/useCommentLayout';
import { useActiveMarker } from '../hooks/useActiveMarker';
import { classifyAnnotation } from '../utils';

export type { TraitAnnotation } from '../types';

export type AnyAnnotation = TraitAnnotation | CriteriaAnnotation;

interface Props {
  content: string;
  annotations: AnyAnnotation[];
  onChange?: (content: string) => void;
  readOnly?: boolean;
  activeTrait?: TraitKey | null;
}

interface AnnotationMarker {
  start: number;
  end: number;
  annotation: AnyAnnotation;
  id: string;
  kind: 'praise' | 'suggestion';
}

export default function AnnotatedEssay({ content, annotations, onChange, readOnly = true, activeTrait }: Props) {
  const essayRef = useRef<HTMLDivElement>(null);
  const [activeId, handleMarkClick] = useActiveMarker(essayRef);

  // Filter annotations by active trait if set
  const filteredAnnotations = useMemo(() => {
    if (!activeTrait) return annotations;
    return annotations.filter(a => 'traitKey' in a && a.traitKey === activeTrait);
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

  const commentPositions = useCommentLayout(essayRef, markers, 'data-ann-id');

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
              <span className="sidebar-comment-trait">{'traitLabel' in m.annotation ? m.annotation.traitLabel : m.annotation.criterionText}</span>
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
