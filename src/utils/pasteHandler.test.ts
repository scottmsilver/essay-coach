import { describe, it, expect } from 'vitest';
import { htmlToPlainText } from './pasteHandler';

describe('htmlToPlainText', () => {
  it('extracts text from simple paragraphs', () => {
    const result = htmlToPlainText('<p>Hello</p><p>World</p>');
    expect(result).toBe('Hello\n\nWorld');
  });

  it('preserves first-line indentation from text-indent style', () => {
    const html = '<p style="text-indent: 36pt">Indented paragraph</p><p>Normal paragraph</p>';
    const result = htmlToPlainText(html);
    expect(result).toBe('\tIndented paragraph\n\nNormal paragraph');
  });

  it('preserves indentation on multiple paragraphs', () => {
    const html = `
      <p style="text-indent: 36pt">First paragraph</p>
      <p style="text-indent: 36pt">Second paragraph</p>
      <p>No indent</p>
    `;
    const result = htmlToPlainText(html);
    expect(result).toBe('\tFirst paragraph\n\n\tSecond paragraph\n\nNo indent');
  });

  it('adds bullet markers for unordered list items', () => {
    const html = '<ul><li>Item one</li><li>Item two</li></ul>';
    const result = htmlToPlainText(html);
    expect(result).toBe('\u2022 Item one\n\n\u2022 Item two');
  });

  it('adds numbered markers for ordered list items', () => {
    const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
    const result = htmlToPlainText(html);
    expect(result).toBe('1. First\n\n2. Second\n\n3. Third');
  });

  it('handles mixed paragraphs and lists', () => {
    const html = `
      <p style="text-indent: 36pt">Intro paragraph</p>
      <ul><li>Bullet one</li><li>Bullet two</li></ul>
      <p>Conclusion</p>
    `;
    const result = htmlToPlainText(html);
    expect(result).toContain('\tIntro paragraph');
    expect(result).toContain('\u2022 Bullet one');
    expect(result).toContain('\u2022 Bullet two');
    expect(result).toContain('Conclusion');
  });

  it('removes footnote markers (sup/sub)', () => {
    const html = '<p>Some text<sup>1</sup> continues</p>';
    const result = htmlToPlainText(html);
    expect(result).toBe('Some text  continues');
  });

  it('handles Google Docs style HTML with spans', () => {
    const html = `
      <p dir="ltr" style="text-indent: 36pt; margin-top: 0pt; margin-bottom: 12pt;">
        <span style="font-size: 12pt; font-family: 'Times New Roman';">Essay paragraph here</span>
      </p>
    `;
    const result = htmlToPlainText(html);
    expect(result).toBe('\tEssay paragraph here');
  });

  it('collapses excessive newlines', () => {
    const html = '<p>A</p><br><br><p>B</p>';
    const result = htmlToPlainText(html);
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('falls back to textContent for plain HTML', () => {
    const result = htmlToPlainText('Just plain text');
    expect(result).toBe('Just plain text');
  });

  it('handles Google Docs <b> wrapper with paragraphs inside', () => {
    const html = `
      <meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc123">
        <p dir="ltr" style="line-height:2.4;margin-top:0pt;margin-bottom:0pt;">
          <span>Header Line</span>
        </p>
        <p dir="ltr" style="line-height:2.4;text-indent:36pt;margin-top:0pt;margin-bottom:0pt;">
          <span>Body paragraph with content.</span>
        </p>
      </b>
    `;
    const result = htmlToPlainText(html);
    expect(result).toContain('Header Line');
    expect(result).toContain('Body paragraph with content.');
  });

  it('collects orphaned spans that Google Docs emits outside <p> tags', () => {
    // Real Google Docs behavior: header lines get <p> tags but the body paragraph
    // is emitted as bare <span> elements after the last </p>.
    const html = `
      <meta charset="utf-8"><b style="font-weight:normal;" id="docs-internal-guid-abc123">
        <p dir="ltr" style="line-height:2.4;margin-top:0pt;margin-bottom:0pt;">
          <span>Author Name</span>
        </p>
        <p dir="ltr" style="line-height:2.4;margin-top:0pt;margin-bottom:0pt;">
          <span>Class Info</span>
        </p>
        <p dir="ltr" style="line-height:2.4;text-indent:36pt;text-align:center;margin-top:0pt;margin-bottom:0pt;">
          <span>Essay Title</span>
        </p>
        <span>In 1949, Joseph Campbell released his book. </span>
        <span>This is the body of the essay that was not wrapped in a paragraph tag. </span>
        <span>It contains multiple spans with the full essay content.</span>
      </b>
    `;
    const result = htmlToPlainText(html);
    expect(result).toContain('Author Name');
    expect(result).toContain('Class Info');
    expect(result).toContain('Essay Title');
    expect(result).toContain('In 1949, Joseph Campbell released his book.');
    expect(result).toContain('full essay content.');
    // The orphaned spans should be collected as a separate paragraph
    const parts = result.split('\n\n');
    expect(parts.length).toBeGreaterThanOrEqual(4);
  });
});
