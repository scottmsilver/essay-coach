import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks ─────────────────────────────────────────────────────────────

const mockGenerateContentStream = vi.fn();

vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContentStream: (...args: unknown[]) => mockGenerateContentStream(...args) },
  })),
}));

import { streamGeminiJson } from './streamGemini';

// ─── Helpers ────────────────────────────────────────────────────────────

function makeStreamResult(text: string) {
  return {
    [Symbol.asyncIterator]: async function* () {
      yield {
        candidates: [{ content: { parts: [{ text, thought: false }] } }],
      };
    },
  };
}

function baseOpts() {
  return {
    apiKey: 'test-key',
    contents: 'test content',
    systemInstruction: 'test instruction',
    responseSchema: { type: 'object' as const },
    statusField: 'evaluationStatus',
    generatingMessage: 'Generating...',
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('streamGeminiJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGenerateContentStream.mockReturnValue(makeStreamResult('{"ok":true}'));
  });

  it('uses default model (gemini-3.1-pro-preview) when none specified', async () => {
    await streamGeminiJson(baseOpts());

    expect(mockGenerateContentStream).toHaveBeenCalledOnce();
    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.model).toBe('gemini-3.1-pro-preview');
  });

  it('uses custom model when model option is provided', async () => {
    await streamGeminiJson({ ...baseOpts(), model: 'gemini-3.1-flash-light' });

    expect(mockGenerateContentStream).toHaveBeenCalledOnce();
    const callArgs = mockGenerateContentStream.mock.calls[0][0];
    expect(callArgs.model).toBe('gemini-3.1-flash-light');
  });

  it('returns the streamed output text', async () => {
    const result = await streamGeminiJson(baseOpts());
    expect(result).toBe('{"ok":true}');
  });

  it('throws when Gemini returns an empty response', async () => {
    mockGenerateContentStream.mockReturnValue(makeStreamResult(''));

    await expect(streamGeminiJson(baseOpts())).rejects.toThrow('Gemini returned an empty response');
  });
});
