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
    expect(splitSentences('Wait... really? Yes.')).toEqual([
      'Wait... really?',
      'Yes.',
    ]);
    expect(splitSentences('Wait... Really? Yes.')).toEqual([
      'Wait...',
      'Really?',
      'Yes.',
    ]);
  });

  // --- Middle initials ---

  it('does not split on middle initials like "Sarah J. Maas"', () => {
    expect(splitSentences('Sarah J. Maas wrote a novel. It was popular.')).toEqual([
      'Sarah J. Maas wrote a novel.',
      'It was popular.',
    ]);
  });

  it('does not split on middle initials in longer sentences', () => {
    expect(splitSentences(
      "In her analysis, Sarah J. Maas's A Court of Thorns and Roses spotlights resilience. The hero's journey applies."
    )).toEqual([
      "In her analysis, Sarah J. Maas's A Court of Thorns and Roses spotlights resilience.",
      "The hero's journey applies.",
    ]);
  });

  it('does not split on middle initials with multiple names', () => {
    expect(splitSentences('Martin Luther King Jr. led the movement. His legacy endures.')).toEqual([
      'Martin Luther King Jr. led the movement.',
      'His legacy endures.',
    ]);
  });

  it('does not split on middle initials: Michael B. Jordan', () => {
    expect(splitSentences('Michael B. Jordan starred in the film. It was a hit.')).toEqual([
      'Michael B. Jordan starred in the film.',
      'It was a hit.',
    ]);
  });

  it('does not split on middle initials: Samuel L. Jackson', () => {
    expect(splitSentences('Samuel L. Jackson is a famous actor. He has starred in many films.')).toEqual([
      'Samuel L. Jackson is a famous actor.',
      'He has starred in many films.',
    ]);
  });

  it('does not split on middle initials: J. K. Rowling', () => {
    expect(splitSentences('J. K. Rowling wrote Harry Potter. The series became iconic.')).toEqual([
      'J. K. Rowling wrote Harry Potter.',
      'The series became iconic.',
    ]);
  });

  it('does not split on middle initials with possessive: Sarah J. Maas\'s', () => {
    expect(splitSentences(
      "Overlaying this journey upon Sarah J. Maas's A Court of Thorns and Roses spotlights resilience."
    )).toEqual([
      "Overlaying this journey upon Sarah J. Maas's A Court of Thorns and Roses spotlights resilience.",
    ]);
  });

  it('still splits after single-letter labels like "section A."', () => {
    expect(splitSentences('Go to section A. The next part is important.')).toEqual([
      'Go to section A.',
      'The next part is important.',
    ]);
  });

  it('still splits after lowercase word + single letter: "item b."', () => {
    expect(splitSentences('See item b. The answer is there.')).toEqual([
      'See item b.',
      'The answer is there.',
    ]);
  });

  // --- U.S. and multi-letter initials ---

  it('does not split on U.S. or similar initials', () => {
    expect(splitSentences('They discussed U.S. policy. It was important.')).toEqual([
      'They discussed U.S. policy.',
      'It was important.',
    ]);
  });

  // --- Quotes ---

  it('handles smart quotes', () => {
    expect(splitSentences('He said \u201Chello.\u201D She waved.')).toEqual([
      'He said \u201Chello.\u201D',
      'She waved.',
    ]);
  });

  // --- Edge cases ---

  it('returns empty array for empty/whitespace input', () => {
    expect(splitSentences('')).toEqual([]);
    expect(splitSentences('   ')).toEqual([]);
  });

  it('returns single sentence when no boundaries found', () => {
    expect(splitSentences('Just a fragment without ending punctuation')).toEqual([
      'Just a fragment without ending punctuation',
    ]);
  });

  it('handles multiple sentences with mixed punctuation', () => {
    expect(splitSentences('Is this real? Yes it is! And it works.')).toEqual([
      'Is this real?',
      'Yes it is!',
      'And it works.',
    ]);
  });

  it('handles et al. citation', () => {
    expect(splitSentences('Smith et al. found this result. It was significant.')).toEqual([
      'Smith et al. found this result.',
      'It was significant.',
    ]);
  });

  it('handles page references like p. 42', () => {
    expect(splitSentences('As noted on p. 42 of the text. The author agrees.')).toEqual([
      'As noted on p. 42 of the text.',
      'The author agrees.',
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

    // Mock returns correct flat array for each paragraph call
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify(['First sentence.', 'Second sentence.']) })
      .mockResolvedValueOnce({ text: JSON.stringify(['Third sentence.', 'Fourth sentence.']) });

    const result = await splitSentencesAI('fake-key', [
      'First sentence. Second sentence.',
      'Third sentence. Fourth sentence.',
    ]);
    expect(result).toEqual([
      ['First sentence.', 'Second sentence.'],
      ['Third sentence.', 'Fourth sentence.'],
    ]);
    expect(mockGenerateContent).toHaveBeenCalledTimes(2);
  });

  it('strips markdown code fence from Gemma response', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValueOnce({
      text: '```json\n' + JSON.stringify(['Hello.', 'World.']) + '\n```',
    });

    const result = await splitSentencesAI('fake-key', ['Hello. World.']);
    expect(result).toEqual([['Hello.', 'World.']]);
  });

  it('falls back to regex for paragraph where Gemma returns invalid JSON', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent
      .mockResolvedValueOnce({ text: 'not valid json at all' })
      .mockResolvedValueOnce({ text: JSON.stringify(['Good sentence.', 'Another one.']) });

    const result = await splitSentencesAI('fake-key', [
      'Hello world. Goodbye.',
      'Good sentence. Another one.',
    ]);
    // First paragraph falls back to regex, second uses Gemma
    expect(result[0]).toContain('Hello world.');
    expect(result[0]).toContain('Goodbye.');
    expect(result[1]).toEqual(['Good sentence.', 'Another one.']);
  });

  it('falls back to regex when Gemma API throws', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockRejectedValue(new Error('API error'));

    const result = await splitSentencesAI('fake-key', ['Test sentence. Another one.']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Test sentence.');
    expect(result[0]).toContain('Another one.');
  });

  it('falls back to regex when inner array contains non-strings', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify([123, 456]),
    });

    const result = await splitSentencesAI('fake-key', ['Hello. World.']);
    expect(result).toHaveLength(1);
    expect(result[0][0]).toBe('Hello.');
  });

  it('falls back to regex when Gemma mutates the text', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(['Hi world.', 'Goodbye.']),
    });

    const result = await splitSentencesAI('fake-key', ['Hello world. Goodbye.']);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('Hello world.');
    expect(result[0]).toContain('Goodbye.');
  });

  it('filters empty strings from Gemma response', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValueOnce({
      text: JSON.stringify(['Hello world.', '', 'Goodbye.']),
    });

    const result = await splitSentencesAI('fake-key', ['Hello world. Goodbye.']);
    expect(result).toEqual([['Hello world.', 'Goodbye.']]);
  });

  it('strips code fence with preamble text', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    mockGenerateContent.mockResolvedValueOnce({
      text: 'Here are the sentences:\n```json\n' + JSON.stringify(['Hello.', 'World.']) + '\n```',
    });

    const result = await splitSentencesAI('fake-key', ['Hello. World.']);
    expect(result).toEqual([['Hello.', 'World.']]);
  });

  it('handles per-paragraph fallback independently', async () => {
    const { splitSentencesAI } = await import('../src/sentenceSplitter');

    // Paragraph 0: Gemma succeeds
    // Paragraph 1: Gemma throws
    // Paragraph 2: Gemma succeeds
    mockGenerateContent
      .mockResolvedValueOnce({ text: JSON.stringify(['First.', 'Second.']) })
      .mockRejectedValueOnce(new Error('timeout'))
      .mockResolvedValueOnce({ text: JSON.stringify(['Fifth.', 'Sixth.']) });

    const result = await splitSentencesAI('fake-key', [
      'First. Second.',
      'Third. Fourth.',
      'Fifth. Sixth.',
    ]);

    expect(result[0]).toEqual(['First.', 'Second.']);     // Gemma
    expect(result[1]).toContain('Third.');                 // regex fallback
    expect(result[1]).toContain('Fourth.');                // regex fallback
    expect(result[2]).toEqual(['Fifth.', 'Sixth.']);       // Gemma
  });
});
