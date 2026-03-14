import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockGenerateContent = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: {
      generateContent: mockGenerateContent,
    },
  })),
}));

import { evaluateWithGemini } from '../src/gemini';

describe('evaluateWithGemini', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns parsed JSON from Gemini response', async () => {
    const mockEvaluation = {
      traits: {
        ideas: { score: 4, feedback: 'Good', revisionPriority: null, annotations: [] },
        organization: { score: 3, feedback: 'OK', revisionPriority: 1, annotations: [] },
        voice: { score: 5, feedback: 'Great', revisionPriority: null, annotations: [] },
        wordChoice: { score: 3, feedback: 'Needs work', revisionPriority: 2, annotations: [] },
        sentenceFluency: { score: 4, feedback: 'Solid', revisionPriority: null, annotations: [] },
        conventions: { score: 2, feedback: 'Fix', revisionPriority: 3, annotations: [] },
        presentation: { score: 4, feedback: 'Fine', revisionPriority: null, annotations: [] },
      },
      overallFeedback: 'Nice work',
      revisionPlan: ['Fix conventions'],
      comparisonToPrevious: null,
    };

    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockEvaluation),
    });

    const result = await evaluateWithGemini('fake-key', 'evaluate this');
    expect(result).toEqual(mockEvaluation);
  });

  it('throws on empty Gemini response', async () => {
    mockGenerateContent.mockResolvedValue({ text: null });
    await expect(evaluateWithGemini('fake-key', 'evaluate this')).rejects.toThrow('empty response');
  });

  it('throws on invalid JSON response', async () => {
    mockGenerateContent.mockResolvedValue({ text: 'not json' });
    await expect(evaluateWithGemini('fake-key', 'evaluate this')).rejects.toThrow();
  });
});
