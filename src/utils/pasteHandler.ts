/**
 * Handles paste events from rich text sources (Google Docs, Word, etc.)
 * by extracting HTML and converting structural elements to plain text
 * with proper paragraph breaks preserved.
 *
 * FORMAT CONTRACT (must stay in sync with functions/scripts/apps-script-source.ts):
 *   - Indented paragraphs → \t prefix
 *   - Bullet list items → \u2022 (•) prefix
 *   - Numbered list items → N. prefix
 *   - Paragraph separation → \n\n
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
  const text = htmlToPlainText(html);

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

function hasTextIndent(el: Element): boolean {
  if (el instanceof HTMLElement && parseFloat(el.style.textIndent) > 0) return true;
  const style = el.getAttribute('style') ?? '';
  const match = style.match(/text-indent:\s*([\d.]+)/);
  return match !== null && parseFloat(match[1]) > 0;
}

const BLOCK_TAGS = new Set(['p', 'div', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'li', 'ul', 'ol', 'blockquote', 'pre', 'table', 'section', 'article']);

/**
 * Check if a node is a block-level element.
 */
function isBlock(node: Node): boolean {
  return node.nodeType === 1 && BLOCK_TAGS.has((node as Element).tagName.toLowerCase());
}

/**
 * Extract text from a block element, applying formatting (indent, list markers).
 */
function extractBlockText(block: Element): string | null {
  const text = block.textContent?.trim();
  if (!text) return null;

  const tag = block.tagName.toLowerCase();
  if (tag === 'li') {
    const parent = block.parentElement;
    if (parent && parent.tagName.toLowerCase() === 'ol') {
      const idx = Array.from(parent.children).indexOf(block) + 1;
      return idx + '. ' + text;
    }
    return '\u2022 ' + text;
  }
  if (hasTextIndent(block)) {
    return '\t' + text;
  }
  return text;
}

/**
 * Walk the children of a container and collect text parts.
 * Handles both proper block elements (<p>, <div>, etc.) and orphaned inline
 * content (bare <span> elements that Google Docs sometimes emits outside <p> tags).
 */
function collectParts(container: Element): string[] {
  const parts: string[] = [];
  let orphanedText = '';

  for (const child of Array.from(container.childNodes)) {
    if (child.nodeType === 1) {
      const el = child as Element;
      const tag = el.tagName.toLowerCase();

      if (isBlock(el)) {
        // Flush any accumulated orphaned inline text
        if (orphanedText.trim()) {
          parts.push(orphanedText.trim());
          orphanedText = '';
        }

        if (tag === 'br') {
          parts.push('\n');
        } else if (tag === 'ul' || tag === 'ol') {
          // Process list items inside the list
          for (const li of Array.from(el.querySelectorAll('li'))) {
            const t = extractBlockText(li);
            if (t) parts.push(t);
          }
        } else {
          const t = extractBlockText(el);
          if (t) parts.push(t);
        }
      } else if (tag === 'br') {
        // Bare <br> not inside a block — treat as paragraph break
        if (orphanedText.trim()) {
          parts.push(orphanedText.trim());
          orphanedText = '';
        }
      } else {
        // Inline element (span, b, i, a, etc.) not inside a block — orphaned content
        orphanedText += el.textContent ?? '';
      }
    } else if (child.nodeType === 3) {
      // Text node — could be orphaned content between blocks
      const t = child.textContent ?? '';
      if (t.trim()) {
        orphanedText += t;
      }
    }
  }

  // Flush any remaining orphaned text
  if (orphanedText.trim()) {
    parts.push(orphanedText.trim());
  }

  return parts;
}

/**
 * Strip the Google Docs <b style="font-weight:normal;" id="docs-internal-guid-..."> wrapper.
 * Google Docs wraps clipboard HTML in this <b> tag. Since <b> is phrasing content,
 * <p> elements can't legally nest inside it, causing DOMParser to mangle the structure.
 */
function fixGoogleDocsHtml(html: string): string {
  return html
    .replace(/<b\b[^>]*id="docs-internal-guid-[^"]*"[^>]*>/gi, '')
    .replace(/<\/b>\s*$/i, '');
}

export function htmlToPlainText(rawHtml: string): string {
  const fixed = fixGoogleDocsHtml(rawHtml);
  const doc = new DOMParser().parseFromString(fixed, 'text/html');
  const root = doc.body;

  // Remove sup/sub elements (footnote markers) and replace with a space
  // to avoid smooshing adjacent words
  for (const el of Array.from(root.querySelectorAll('sup, sub, style, script'))) {
    const space = doc.createTextNode(' ');
    el.parentNode?.replaceChild(space, el);
  }

  // Walk the DOM tree, collecting both block elements and orphaned inline content.
  // Google Docs sometimes emits bare <span> elements outside of <p> tags.
  const parts = collectParts(root);

  if (parts.length > 0) {
    return parts.join('\n\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/^\n+/, '')
      .replace(/\s+$/, '');
  }

  // Fallback: just use textContent (handles simple HTML without block elements)
  return (root.textContent ?? '').trim();
}
