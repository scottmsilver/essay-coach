import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildGrammarPrompt } from '../src/grammar';

describe('buildGrammarPrompt', () => {
  it('wraps essay content in the prompt template', () => {
    const content = 'This is a test essay.';
    const result = buildGrammarPrompt(content);
    expect(result).toContain('This is a test essay.');
    expect(result).toContain('comprehensive grammar and mechanics analysis');
    expect(result).toContain('---');
  });

  it('preserves multiline content', () => {
    const content = 'Paragraph one.\n\nParagraph two.';
    const result = buildGrammarPrompt(content);
    expect(result).toContain('Paragraph one.\n\nParagraph two.');
  });
});

const mockGenerateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContentStream: mockGenerateContentStream,
    },
  })),
}));

describe('analyzeGrammarWithGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed GrammarAnalysis from Gemini response', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    const mockAnalysis = {
      commaSplices: { locations: [] },
      runOnSentences: { locations: [] },
      fragments: { locations: [] },
      subjectVerbAgreement: { locations: [] },
      pronounReference: { locations: [] },
      verbTenseConsistency: { locations: [] },
      parallelStructure: { locations: [] },
      punctuationErrors: { locations: [] },
      missingCommas: { locations: [] },
      sentenceVariety: { avgLength: 15, distribution: { simple: 3, compound: 2, complex: 1, compoundComplex: 0 }, comment: 'Good variety.' },
      activePassiveVoice: { activeCount: 5, passiveCount: 1, passiveInstances: [] },
      modifierPlacement: { issues: [] },
      wordiness: { instances: [] },
      summary: {
        totalErrors: 0,
        errorsByCategory: {
          commaSplices: 0, runOnSentences: 0, fragments: 0,
          subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0,
          parallelStructure: 0, punctuationErrors: 0, missingCommas: 0,
        },
        overallComment: 'Clean writing.',
        strengthAreas: ['Good grammar'],
        priorityFixes: [],
      },
    };

    const jsonText = JSON.stringify(mockAnalysis);
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: jsonText }] } }] };
      },
    });

    const result = await analyzeGrammarWithGemini('fake-key', 'Test essay.');
    expect(result.summary.overallComment).toBe('Clean writing.');
    expect(result.sentenceVariety.avgLength).toBe(15);
  });

  it('throws on empty Gemini response', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ thought: true, text: 'thinking...' }] } }] };
      },
    });

    await expect(analyzeGrammarWithGemini('fake-key', 'Test essay.')).rejects.toThrow('empty response');
  });

  it('throws on invalid JSON from Gemini', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: 'not valid json {{{' }] } }] };
      },
    });

    await expect(analyzeGrammarWithGemini('fake-key', 'Test essay.')).rejects.toThrow();
  });

  it('writes progress updates to progressRef during streaming', async () => {
    const { analyzeGrammarWithGemini } = await import('../src/grammar');

    const mockAnalysis = {
      commaSplices: { locations: [] }, runOnSentences: { locations: [] },
      fragments: { locations: [] }, subjectVerbAgreement: { locations: [] },
      pronounReference: { locations: [] }, verbTenseConsistency: { locations: [] },
      parallelStructure: { locations: [] }, punctuationErrors: { locations: [] },
      missingCommas: { locations: [] },
      sentenceVariety: { avgLength: 10, distribution: { simple: 1, compound: 0, complex: 0, compoundComplex: 0 }, comment: 'OK' },
      activePassiveVoice: { activeCount: 1, passiveCount: 0, passiveInstances: [] },
      modifierPlacement: { issues: [] }, wordiness: { instances: [] },
      summary: { totalErrors: 0, errorsByCategory: { commaSplices: 0, runOnSentences: 0, fragments: 0, subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0, parallelStructure: 0, punctuationErrors: 0, missingCommas: 0 }, overallComment: 'Clean.', strengthAreas: [], priorityFixes: [] },
    };

    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ thought: true, text: 'Analyzing grammar...' }] } }] };
        yield { candidates: [{ content: { parts: [{ text: JSON.stringify(mockAnalysis) }] } }] };
      },
    });

    const mockRef = { update: vi.fn().mockResolvedValue(undefined) } as any;
    await analyzeGrammarWithGemini('fake-key', 'Test essay.', mockRef);
    expect(mockRef.update).toHaveBeenCalled();
  });
});
