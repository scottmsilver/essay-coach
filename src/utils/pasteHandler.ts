/**
 * Handles paste events from rich text sources (Google Docs, Word, etc.)
 * by extracting HTML and converting structural elements to plain text
 * with proper paragraph breaks preserved.
 */
export function handleRichPaste(
  e: React.ClipboardEvent<HTMLTextAreaElement>,
  setValue: (value: string) => void,
) {
  const html = e.clipboardData.getData('text/html');
  if (!html) return; // No HTML — let browser handle plain text paste normally

  e.preventDefault();

  const textarea = e.currentTarget;

  // Parse the HTML and extract text with paragraph structure
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const text = htmlToPlainText(doc.body);

  // Insert at cursor position (or replace selection)
  const start = textarea.selectionStart;
  const end = textarea.selectionEnd;
  const current = textarea.value;
  const newValue = current.slice(0, start) + text + current.slice(end);
  setValue(newValue);

  // Restore cursor position after React re-render
  requestAnimationFrame(() => {
    textarea.selectionStart = textarea.selectionEnd = start + text.length;
  });
}

function htmlToPlainText(root: Node): string {
  const doc = root.ownerDocument ?? (root as Document);

  // Remove sup/sub elements (footnote markers) and replace with a space
  // to avoid smooshing adjacent words
  if (root instanceof (doc.defaultView ?? window).Element) {
    for (const el of Array.from(root.querySelectorAll('sup, sub, style, script'))) {
      // Insert a space where the element was to prevent word smooshing
      const space = doc.createTextNode(' ');
      el.parentNode?.replaceChild(space, el);
    }
  }

  // Collect block elements (p, div, h1-h6) and extract their textContent
  // Using textContent preserves spacing between adjacent inline elements (spans)
  const blocks = root instanceof (doc.defaultView ?? window).Element
    ? Array.from(root.querySelectorAll('p, div, h1, h2, h3, h4, h5, h6, li, br'))
    : [];

  if (blocks.length > 0) {
    const parts: string[] = [];
    const seen = new WeakSet<Node>();

    for (const block of blocks) {
      // Skip blocks nested inside other blocks we've already processed
      if (seen.has(block)) continue;

      const tag = block.tagName.toLowerCase();

      if (tag === 'br') {
        parts.push('\n');
        continue;
      }

      // Mark nested blocks as seen so we don't double-process
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

  // Fallback: just use textContent (handles simple HTML without block elements)
  return (root.textContent ?? '').trim();
}
