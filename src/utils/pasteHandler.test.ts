import { describe, it, expect } from 'vitest';
import { htmlToPlainText } from './pasteHandler';

function parse(html: string): Node {
  return new DOMParser().parseFromString(html, 'text/html').body;
}

describe('htmlToPlainText', () => {
  it('extracts text from simple paragraphs', () => {
    const result = htmlToPlainText(parse('<p>Hello</p><p>World</p>'));
    expect(result).toBe('Hello\n\nWorld');
  });

  it('preserves first-line indentation from text-indent style', () => {
    const html = '<p style="text-indent: 36pt">Indented paragraph</p><p>Normal paragraph</p>';
    const result = htmlToPlainText(parse(html));
    expect(result).toBe('\tIndented paragraph\n\nNormal paragraph');
  });

  it('preserves indentation on multiple paragraphs', () => {
    const html = `
      <p style="text-indent: 36pt">First paragraph</p>
      <p style="text-indent: 36pt">Second paragraph</p>
      <p>No indent</p>
    `;
    const result = htmlToPlainText(parse(html));
    expect(result).toBe('\tFirst paragraph\n\n\tSecond paragraph\n\nNo indent');
  });

  it('adds bullet markers for unordered list items', () => {
    const html = '<ul><li>Item one</li><li>Item two</li></ul>';
    const result = htmlToPlainText(parse(html));
    expect(result).toBe('\u2022 Item one\n\n\u2022 Item two');
  });

  it('adds numbered markers for ordered list items', () => {
    const html = '<ol><li>First</li><li>Second</li><li>Third</li></ol>';
    const result = htmlToPlainText(parse(html));
    expect(result).toBe('1. First\n\n2. Second\n\n3. Third');
  });

  it('handles mixed paragraphs and lists', () => {
    const html = `
      <p style="text-indent: 36pt">Intro paragraph</p>
      <ul><li>Bullet one</li><li>Bullet two</li></ul>
      <p>Conclusion</p>
    `;
    const result = htmlToPlainText(parse(html));
    expect(result).toContain('\tIntro paragraph');
    expect(result).toContain('\u2022 Bullet one');
    expect(result).toContain('\u2022 Bullet two');
    expect(result).toContain('Conclusion');
  });

  it('removes footnote markers (sup/sub)', () => {
    const html = '<p>Some text<sup>1</sup> continues</p>';
    const result = htmlToPlainText(parse(html));
    expect(result).toBe('Some text  continues');
  });

  it('handles Google Docs style HTML with spans', () => {
    const html = `
      <p dir="ltr" style="text-indent: 36pt; margin-top: 0pt; margin-bottom: 12pt;">
        <span style="font-size: 12pt; font-family: 'Times New Roman';">Essay paragraph here</span>
      </p>
    `;
    const result = htmlToPlainText(parse(html));
    expect(result).toBe('\tEssay paragraph here');
  });

  it('collapses excessive newlines', () => {
    const html = '<p>A</p><br><br><p>B</p>';
    const result = htmlToPlainText(parse(html));
    expect(result).not.toMatch(/\n{3,}/);
  });

  it('falls back to textContent for plain HTML', () => {
    const result = htmlToPlainText(parse('Just plain text'));
    expect(result).toBe('Just plain text');
  });
});
