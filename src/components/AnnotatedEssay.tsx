import { useMemo } from 'react';
import type { Annotation } from '../types';

interface Props {
  content: string;
  annotations: Annotation[];
  onChange: (content: string) => void;
  readOnly?: boolean;
}

export default function AnnotatedEssay({ content, annotations, onChange, readOnly }: Props) {
  const highlightedHtml = useMemo(() => {
    if (annotations.length === 0) return escapeHtml(content);
    let html = escapeHtml(content);
    const sorted = [...annotations].sort((a, b) => b.quotedText.length - a.quotedText.length);
    for (const ann of sorted) {
      const escaped = escapeHtml(ann.quotedText);
      const idx = html.indexOf(escaped);
      if (idx !== -1) {
        html = html.slice(0, idx) +
          `<mark title="${escapeAttr(ann.comment)}">${escaped}</mark>` +
          html.slice(idx + escaped.length);
      }
    }
    return html.replace(/\n/g, '<br/>');
  }, [content, annotations]);

  if (readOnly) {
    return (
      <div className="essay-preview" style={{ padding: 16, lineHeight: 1.8, fontSize: 14 }}
        dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
    );
  }

  return (
    <div>
      <textarea className="essay-editor" value={content} onChange={(e) => onChange(e.target.value)} />
      {annotations.length > 0 && (
        <details style={{ marginTop: 8 }}>
          <summary style={{ fontSize: 13, color: 'var(--color-text-secondary)', cursor: 'pointer' }}>
            Show highlighted passages
          </summary>
          <div style={{ padding: 16, background: 'var(--color-surface)', borderRadius: 6, marginTop: 8, lineHeight: 1.8, fontSize: 14 }}
            dangerouslySetInnerHTML={{ __html: highlightedHtml }} />
        </details>
      )}
    </div>
  );
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function escapeAttr(text: string): string {
  return escapeHtml(text).replace(/'/g, '&#39;');
}
