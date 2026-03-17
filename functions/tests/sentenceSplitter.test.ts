import { describe, it, expect, vi, beforeEach } from 'vitest';
import { splitSentences } from '../src/sentenceSplitter';

describe('splitSentences (regex)', () => {
  it('splits simple sentences on period', () => {
    expect(splitSentences('Hello world. Goodbye world.')).toEqual([
      'Hello world.',
      'Goodbye world.',
    ]);
  });

  it('handles question marks and exclamation points', () => {
    expect(splitSentences('Really? Yes! Absolutely.')).toEqual([
      'Really?',
      'Yes!',
      'Absolutely.',
    ]);
  });

  it('does not split on abbreviations', () => {
    expect(splitSentences('Dr. Smith went home. He was tired.')).toEqual([
      'Dr. Smith went home.',
      'He was tired.',
    ]);
  });

  it('handles Mr., Mrs., Sen., etc.', () => {
    expect(splitSentences('Mr. and Mrs. Jones arrived. Sen. Johnson greeted them.')).toEqual([
      'Mr. and Mrs. Jones arrived.',
      'Sen. Johnson greeted them.',
    ]);
  });

  it('does not split on decimals', () => {
    expect(splitSentences('The price is 3.14 dollars. That seems fair.')).toEqual([
      'The price is 3.14 dollars.',
      'That seems fair.',
    ]);
  });

  it('handles ellipses', () => {
    // lowercase after ellipsis: not a sentence break
    expect(splitSentences('Wait... really? Yes.')).toEqual([
      'Wait... really?',
      'Yes.',
    ]);
    // uppercase after ellipsis: sentence break
    expect(splitSentences('Wait... Really? Yes.')).toEqual([
      'Wait...',
      'Really?',
      'Yes.',
    ]);
  });

  it('does not split on U.S. or similar initials', () => {
    const result = splitSentences('They discussed U.S. policy. It was important.');
    expect(result).toEqual([
      'They discussed U.S. policy.',
      'It was important.',
    ]);
  });

  it('handles smart quotes', () => {
    const result = splitSentences('He said \u201Chello.\u201D She waved.');
    expect(result).toEqual([
      'He said \u201Chello.\u201D',
      'She waved.',
    ]);
  });

  it('returns empty array for empty/whitespace input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('returns single sentence when no boundaries found', () => {
    expect(splitSentences('Just a fragment without ending punctuation')).toEqual([
      'Just a fragment without ending punctuation',
    ]);
  });
});

// Mock GoogleGenAI for AI splitter tests
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('splitSentencesAI', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed sentence arrays from Gemma response', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    const gemmaResult = [
      ['First sentence.', 'Second sentence.'],
      ['Third sentence.', 'Fourth sentence.'],
    ];
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(gemmaResult),
    });

    const result = await splitSentencesAI('fake-key', [
      'First sentence. Second sentence.',
      'Third sentence. Fourth sentence.',
    ]);
    expect(result).toEqual(gemmaResult);
  });

  it('strips markdown code fence from Gemma response', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    const gemmaResult = [['Hello.', 'World.']];
    mockGenerateContent.mockResolvedValue({
      text: '```json\n' + JSON.stringify(gemmaResult) + '\n```',
    });

    const result = await splitSentencesAI('fake-key', ['Hello. World.']);
    expect(result).toEqual(gemmaResult);
  });

  it('falls back to regex when Gemma returns wrong number of arrays', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([['Only one.']]),
    });

    const result = await splitSentencesAI('fake-key', [
      'First paragraph. Two sentences.',
      'Second paragraph. Also two.',
    ]);
    // Should fall back to regex — verify it returns 2 arrays
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('First paragraph.');
    expect(result[1]).toContain('Second paragraph.');
  });

  it('falls back to regex when Gemma returns invalid JSON', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValue({
      text: 'not valid json at all',
    });

    const result = await splitSentencesAI('fake-key', ['Hello world. Goodbye.']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Hello world.');
  });

  it('falls back to regex when Gemma API throws', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockRejectedValue(new Error('API error'));

    const result = await splitSentencesAI('fake-key', ['Test sentence. Another one.']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Test sentence.');
    expect(result[0]).toContain('Another one.');
  });

  it('falls back to regex when inner arrays contain non-strings', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([[123, 456]]),
    });

    const result = await splitSentencesAI('fake-key', ['Hello. World.']);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('Hello.');
  });

  it('falls back to regex when Gemma mutates the text', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    // Gemma changed "Hello" to "Hi" — text mismatch should trigger fallback
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([['Hi world.', 'Goodbye.']]),
    });

    const result = await splitSentencesAI('fake-key', ['Hello world. Goodbye.']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Hello world.');
    expect(result[0]).toContain('Goodbye.');
  });

  it('filters empty strings from Gemma response', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([['Hello world.', '', 'Goodbye.']]),
    });

    const result = await splitSentencesAI('fake-key', ['Hello world. Goodbye.']);
    expect(result).toEqual([['Hello world.', 'Goodbye.']]);
  });

  it('strips code fence with preamble text', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    const gemmaResult = [['Hello.', 'World.']];
    mockGenerateContent.mockResolvedValue({
      text: 'Here are the sentences:\n```json\n' + JSON.stringify(gemmaResult) + '\n```',
    });

    const result = await splitSentencesAI('fake-key', ['Hello. World.']);
    expect(result).toEqual(gemmaResult);
  });
});
