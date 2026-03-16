import { useState } from 'react';

/** Duplicated from pasteHandler so we can call it standalone without a fake event */
function htmlToPlainText(root: Node): string {
  const doc = root.ownerDocument ?? (root as Document);

  if (root instanceof (doc.defaultView ?? window).Element) {
    for (const el of Array.from(root.querySelectorAll('sup, sub, style, script'))) {
      const space = doc.createTextNode(' ');
      el.parentNode?.replaceChild(space, el);
    }
  }

  const blocks = root instanceof (doc.defaultView ?? window).Element
    ? Array.from(root.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, br'))
    : [];

  if (blocks.length > 0) {
    const parts: string[] = [];
    const seen = new WeakSet<Node>();

    for (const block of blocks) {
      if (seen.has(block)) continue;
      const tag = block.tagName.toLowerCase();

      if (tag === 'br') {
        parts.push('\n');
        continue;
      }

      for (const nested of Array.from(block.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li'))) {
        seen.add(nested);
      }

      const text = block.textContent?.trim();
      if (!text) continue;

      if (tag === 'li') {
        parts.push('\n' + text);
      } else {
        parts.push(text);
      }
    }

    return parts.join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  return (root.textContent ?? '').trim();
}

export default function ClipboardDebugPage() {
  const [output, setOutput] = useState<string>('');
  const [translated, setTranslated] = useState<string>('');
  const [browserPlain, setBrowserPlain] = useState<string>('');

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    e.preventDefault();
    const lines: string[] = [];

    // List all data types
    const types = Array.from(e.clipboardData.types);
    lines.push(`=== Clipboard Data Types ===`);
    lines.push(types.join(', '));
    lines.push('');

    // Show each type's content
    for (const type of types) {
      const data = e.clipboardData.getData(type);
      lines.push(`=== ${type} (${data.length} chars) ===`);
      if (type === 'text/html') {
        lines.push(data); // raw HTML
      } else {
        lines.push(data);
      }
      lines.push('');
    }

    // Hex dump of first 500 chars of text/plain
    const plain = e.clipboardData.getData('text/plain');
    if (plain) {
      const snippet = plain.slice(0, 500);
      lines.push(`=== Hex Dump (first ${snippet.length} chars of text/plain) ===`);
      const hexLines: string[] = [];
      for (let offset = 0; offset < snippet.length; offset += 16) {
        const chunk = snippet.slice(offset, offset + 16);
        const hexParts: string[] = [];
        const asciiParts: string[] = [];
        for (let i = 0; i < chunk.length; i++) {
          const code = chunk.charCodeAt(i);
          hexParts.push(code.toString(16).padStart(2, '0'));
          asciiParts.push(code >= 32 && code <= 126 ? chunk[i] : '.');
        }
        const hex = hexParts.join(' ').padEnd(48, ' ');
        const ascii = asciiParts.join('');
        hexLines.push(`  ${offset.toString(16).padStart(4, '0')}  ${hex}  |${ascii}|`);
      }
      lines.push(hexLines.join('\n'));
      lines.push('');
    }

    // Find non-ASCII characters in text/plain
    if (plain) {
      lines.push('=== Non-ASCII Characters ===');
      const nonAscii: string[] = [];
      for (let i = 0; i < plain.length; i++) {
        const code = plain.codePointAt(i)!;
        if (code > 127) {
          const char = plain[i];
          nonAscii.push(`  index ${i}: U+${code.toString(16).toUpperCase().padStart(4, '0')} "${char}"`);
        }
      }
      if (nonAscii.length > 0) {
        lines.push(nonAscii.join('\n'));
      } else {
        lines.push('  (none found)');
      }
    }

    setOutput(lines.join('\n'));
    setBrowserPlain(plain || '(no text/plain)');

    // Run the same translation handleRichPaste uses
    const html = e.clipboardData.getData('text/html');
    if (html) {
      const parsed = new DOMParser().parseFromString(html, 'text/html');
      setTranslated(htmlToPlainText(parsed.body));
    } else {
      setTranslated(plain || '(no content)');
    }
  };

  return (
    <div style={{ padding: 20, maxWidth: 1200, margin: '0 auto' }}>
      <h2>Clipboard Debugger</h2>
      <p style={{ color: '#666', fontSize: 14 }}>Paste content here to inspect raw clipboard data and see the translated output side-by-side.</p>
      <textarea
        onPaste={handlePaste}
        placeholder="Paste here to inspect clipboard contents..."
        rows={3}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 14 }}
      />

      {(translated || browserPlain) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#888' }}>Browser text/plain</h3>
            <pre style={{
              padding: 16,
              background: '#1a1a2e',
              color: '#e0e0e0',
              borderRadius: 8,
              overflow: 'auto',
              maxHeight: '40vh',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
            }}>
              {browserPlain}
            </pre>
          </div>
          <div>
            <h3 style={{ margin: '0 0 8px', fontSize: 14, color: '#4ade80' }}>Our translation (handleRichPaste)</h3>
            <pre style={{
              padding: 16,
              background: '#0a1a0e',
              color: '#4ade80',
              borderRadius: 8,
              overflow: 'auto',
              maxHeight: '40vh',
              fontSize: 13,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
              wordBreak: 'break-all',
              border: '1px solid #2d4a2d',
            }}>
              {translated}
            </pre>
          </div>
        </div>
      )}

      {output && (
        <>
          <h3 style={{ margin: '24px 0 8px', fontSize: 14, color: '#888' }}>Raw clipboard data</h3>
          <pre style={{
            padding: 16,
            background: '#1a1a2e',
            color: '#e0e0e0',
            borderRadius: 8,
            overflow: 'auto',
            maxHeight: '50vh',
            fontSize: 13,
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
          }}>
            {output}
          </pre>
        </>
      )}
    </div>
  );
}
