import { describe, it, expect } from 'vitest';
import { validateSubmitEssay, validateResubmitDraft, countWords } from '../src/validation';

describe('countWords', () => {
  it('counts words in a simple sentence', () => {
    expect(countWords('Hello world foo bar')).toBe(4);
  });
  it('returns 0 for empty string', () => {
    expect(countWords('')).toBe(0);
  });
  it('handles extra whitespace', () => {
    expect(countWords('  hello   world  ')).toBe(2);
  });
});

describe('validateSubmitEssay', () => {
  const valid = {
    title: 'My Essay',
    assignmentPrompt: 'Write about Hamlet',
    writingType: 'argumentative',
    content: 'This is my essay content.',
  };

  it('accepts valid input', () => {
    expect(validateSubmitEssay(valid)).toBeNull();
  });
  it('rejects missing title', () => {
    expect(validateSubmitEssay({ ...valid, title: '' })).toMatch(/title/i);
  });
  it('rejects title over 200 chars', () => {
    expect(validateSubmitEssay({ ...valid, title: 'a'.repeat(201) })).toMatch(/title/i);
  });
  it('rejects prompt over 2000 chars', () => {
    expect(validateSubmitEssay({ ...valid, assignmentPrompt: 'a'.repeat(2001) })).toMatch(/prompt/i);
  });
  it('rejects invalid writingType', () => {
    expect(validateSubmitEssay({ ...valid, writingType: 'poetry' })).toMatch(/writing type/i);
  });
  it('rejects content over 10000 words', () => {
    const longContent = Array(10001).fill('word').join(' ');
    expect(validateSubmitEssay({ ...valid, content: longContent })).toMatch(/content/i);
  });
  it('rejects empty content', () => {
    expect(validateSubmitEssay({ ...valid, content: '' })).toMatch(/content/i);
  });
});

describe('validateResubmitDraft', () => {
  it('accepts valid input', () => {
    expect(validateResubmitDraft({ essayId: 'abc', content: 'My revised essay.' })).toBeNull();
  });
  it('rejects missing essayId', () => {
    expect(validateResubmitDraft({ essayId: '', content: 'text' })).toMatch(/essayId/i);
  });
  it('rejects empty content', () => {
    expect(validateResubmitDraft({ essayId: 'abc', content: '' })).toMatch(/content/i);
  });
});
