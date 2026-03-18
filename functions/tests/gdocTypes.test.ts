import { describe, it, expect } from 'vitest';
import { parseSections } from '../../shared/gdocTypes';

describe('parseSections', () => {
  it('returns entire text as one section when no bookmarks', () => {
    const sections = parseSections('Hello world', []);
    expect(sections).toEqual(['Hello world']);
  });

  it('splits text at bookmark offsets', () => {
    const text = 'AAABBBCCC';
    const bookmarks = [
      { id: 'bm1', offset: 3 },
      { id: 'bm2', offset: 6 },
    ];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('handles bookmark at start of text', () => {
    const text = 'AAABBB';
    const bookmarks = [{ id: 'bm1', offset: 0 }, { id: 'bm2', offset: 3 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('handles bookmark at end of text', () => {
    const text = 'AAABBB';
    const bookmarks = [{ id: 'bm1', offset: 3 }, { id: 'bm2', offset: 6 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('filters out empty sections', () => {
    const text = 'AAABBB';
    const bookmarks = [{ id: 'bm1', offset: 3 }, { id: 'bm2', offset: 3 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('strips leading newlines and trailing whitespace from sections', () => {
    const text = '\n\nAAA  \n\n  BBB  ';
    const bookmarks = [{ id: 'bm1', offset: 7 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['AAA', 'BBB']);
  });

  it('preserves leading tabs (paragraph indentation) in sections', () => {
    const text = '\tFirst paragraph\n\n\tSecond section';
    const bookmarks = [{ id: 'bm1', offset: 18 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['\tFirst paragraph', '\tSecond section']);
  });

  it('handles single bookmark splitting into two sections', () => {
    const text = 'Prompt text here\nEssay text here';
    const bookmarks = [{ id: 'bm1', offset: 17 }];
    const sections = parseSections(text, bookmarks);
    expect(sections).toEqual(['Prompt text here', 'Essay text here']);
  });
});
