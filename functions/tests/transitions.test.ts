import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatSentencesForPrompt, buildTransitionPrompt } from '../src/transitions';

describe('formatSentencesForPrompt', () => {
  it('formats single paragraph with numbered sentences', () => {
    const result = formatSentencesForPrompt({
      '0': ['First sentence.', 'Second sentence.'],
    });
    expect(result).toBe('¶1 S1: "First sentence."\n¶1 S2: "Second sentence."');
  });

  it('formats multiple paragraphs with breaks', () => {
    const result = formatSentencesForPrompt({
      '0': ['Para one sent one.', 'Para one sent two.'],
      '1': ['Para two sent one.'],
    });
    expect(result).toContain('¶1 S1: "Para one sent one."');
    expect(result).toContain('¶1 S2: "Para one sent two."');
    expect(result).toContain('--- PARAGRAPH BREAK (¶1 → ¶2) ---');
    expect(result).toContain('¶2 S1: "Para two sent one."');
  });

  it('formats all sentences without filtering (filtering is done upstream)', () => {
    const result = formatSentencesForPrompt({
      '0': ['Real sentence.', 'Another one.'],
    });
    expect(result).toBe('¶1 S1: "Real sentence."\n¶1 S2: "Another one."');
  });

  it('handles empty input', () => {
    expect(formatSentencesForPrompt({})).toBe('');
  });
});

describe('buildTransitionPrompt', () => {
  it('wraps formatted text in the prompt template', () => {
    const formatted = '¶1 S1: "Hello."';
    const result = buildTransitionPrompt(formatted);
    expect(result).toContain('¶1 S1: "Hello."');
    expect(result).toContain('Analyze every transition');
    expect(result).toContain('smooth, adequate, weak, missing');
  });
});

// Mock GoogleGenAI for integration tests
const mockGenerateContentStream = vi.fn();
const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: mockGenerateContentStream,
      generateContent: mockGenerateContent,
    },
  })),
}));

describe('analyzeTransitionsWithGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('includes sentences array in the returned analysis', async () => {
    const { analyzeTransitionsWithGemini } = await import('../src/transitions');

    const mockAnalysis = {
      sentenceTransitions: [
        { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'smooth', comment: 'Good flow.' },
      ],
      paragraphTransitions: [],
      summary: 'Well connected.',
    };

    // Mock Gemma (splitSentencesAI) — returns sentences
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify([['First sentence.', 'Second sentence.']]),
    });

    // Mock Gemini Pro (transition analysis)
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: JSON.stringify(mockAnalysis) }] } }] };
      },
    });

    const result = await analyzeTransitionsWithGemini('fake-key', 'First sentence. Second sentence.');

    expect(result.summary).toBe('Well connected.');
    expect(result.sentences).toBeDefined();
    expect(Object.keys(result.sentences!)).toHaveLength(1);
    expect(result.sentences!['0']).toEqual(['First sentence.', 'Second sentence.']);
  });

  it('falls back to regex sentences when Gemma fails', async () => {
    const { analyzeTransitionsWithGemini } = await import('../src/transitions');

    const mockAnalysis = {
      sentenceTransitions: [],
      paragraphTransitions: [],
      summary: 'OK.',
    };

    // Mock Gemma failure
    mockGenerateContent.mockRejectedValue(new Error('API error'));

    // Mock Gemini Pro
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: JSON.stringify(mockAnalysis) }] } }] };
      },
    });

    const result = await analyzeTransitionsWithGemini('fake-key', 'Hello world. Goodbye.');

    // Should still have sentences (from regex fallback)
    expect(result.sentences).toBeDefined();
    expect(result.sentences!['0']).toContain('Hello world.');
    expect(result.sentences!['0']).toContain('Goodbye.');
  });
});

describe('splitEssayIntoSentences', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('uses regex when no apiKey is provided', async () => {
    const { splitEssayIntoSentences } = await import('../src/transitions');

    const result = await splitEssayIntoSentences('First sentence. Second sentence.\n\nNew paragraph. More text.');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['0']).toEqual(['First sentence.', 'Second sentence.']);
    expect(result['1']).toEqual(['New paragraph.', 'More text.']);
    expect(mockGenerateContent).not.toHaveBeenCalled();
  });

  it('falls back to single-newline splitting when no double-newlines', async () => {
    const { splitEssayIntoSentences } = await import('../src/transitions');

    const result = await splitEssayIntoSentences('Line one. Two.\nLine three. Four.');
    expect(Object.keys(result)).toHaveLength(2);
    expect(result['0']).toEqual(['Line one.', 'Two.']);
    expect(result['1']).toEqual(['Line three.', 'Four.']);
  });

  it('returns Record<string, string[]> format compatible with Firestore (no nested arrays)', async () => {
    const { splitEssayIntoSentences } = await import('../src/transitions');

    const result = await splitEssayIntoSentences('Hello. World.\n\nSecond paragraph.');

    // Must be a plain object with string keys, not an array
    expect(Array.isArray(result)).toBe(false);
    expect(typeof result).toBe('object');

    // Each value must be a flat string array (not nested)
    for (const key of Object.keys(result)) {
      expect(typeof key).toBe('string');
      expect(Array.isArray(result[key])).toBe(true);
      for (const s of result[key]) {
        expect(typeof s).toBe('string');
      }
    }
  });
});
