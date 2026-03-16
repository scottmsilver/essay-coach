import { useState } from 'react';

export default function ClipboardDebugPage() {
  const [output, setOutput] = useState<string>('');

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
  };

  return (
    <div style={{ padding: 20, maxWidth: 900, margin: '0 auto' }}>
      <h2>Clipboard Debugger</h2>
      <p style={{ color: '#666', fontSize: 14 }}>Paste content here to inspect raw clipboard data, HTML structure, and special characters.</p>
      <textarea
        onPaste={handlePaste}
        placeholder="Paste here to inspect clipboard contents..."
        rows={4}
        style={{ width: '100%', fontFamily: 'monospace', fontSize: 14 }}
      />
      {output && (
        <pre style={{
          marginTop: 16,
          padding: 16,
          background: '#1a1a2e',
          color: '#e0e0e0',
          borderRadius: 8,
          overflow: 'auto',
          maxHeight: '70vh',
          fontSize: 13,
          lineHeight: 1.5,
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
        }}>
          {output}
        </pre>
      )}
    </div>
  );
}
