import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock the shared Gemini call layer used by all three analyzers ──────────
const mockStreamGeminiJson = vi.fn();
vi.mock('../src/streamGemini', () => ({
  streamGeminiJson: (...args: any[]) => mockStreamGeminiJson(...args),
}));

import { analyzeGrammarWithGemini, GRAMMAR_SYSTEM_PROMPT, buildGrammarPrompt } from '../src/grammar';
import {
  analyzeTransitionsWithGemini,
  TRANSITION_SYSTEM_PROMPT,
  buildTransitionPrompt,
  formatSentencesForPrompt,
  splitEssayIntoSentences,
} from '../src/transitions';
import { evaluateWithGemini } from '../src/gemini';
import { SYSTEM_PROMPT } from '../src/prompt';

describe('systemPromptOverride', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('analyzeGrammarWithGemini', () => {
    beforeEach(() => {
      mockStreamGeminiJson.mockResolvedValue('{}');
    });

    it('uses GRAMMAR_SYSTEM_PROMPT when no opts are passed', async () => {
      await analyzeGrammarWithGemini('key', 'Some essay content.');

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe(GRAMMAR_SYSTEM_PROMPT);
      expect(callArgs.contents).toBe(buildGrammarPrompt('Some essay content.'));
    });

    it('replaces systemInstruction with the override, leaving the user content unchanged', async () => {
      await analyzeGrammarWithGemini('key', 'Some essay content.', undefined, {
        systemPromptOverride: 'OVERRIDDEN GRAMMAR PROMPT',
      });

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe('OVERRIDDEN GRAMMAR PROMPT');
      expect(callArgs.contents).toBe(buildGrammarPrompt('Some essay content.'));
    });

    it('ignores an empty-string override and behaves byte-identically to no opts', async () => {
      await analyzeGrammarWithGemini('key', 'Some essay content.', undefined, {
        systemPromptOverride: '',
      });

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe(GRAMMAR_SYSTEM_PROMPT);
    });

    it('passes modelOverride through as streamGeminiJson\'s model option, leaving systemInstruction at its default', async () => {
      await analyzeGrammarWithGemini('key', 'Some essay content.', undefined, {
        modelOverride: 'gemini-3.5-flash',
      });

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-3.5-flash');
      expect(callArgs.systemInstruction).toBe(GRAMMAR_SYSTEM_PROMPT);
    });

    it('passes both systemPromptOverride and modelOverride through together', async () => {
      await analyzeGrammarWithGemini('key', 'Some essay content.', undefined, {
        systemPromptOverride: 'OVERRIDDEN GRAMMAR PROMPT',
        modelOverride: 'gemini-3.5-flash',
      });

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-3.5-flash');
      expect(callArgs.systemInstruction).toBe('OVERRIDDEN GRAMMAR PROMPT');
    });

    it('leaves model undefined (so streamGeminiJson falls back to its default) when no modelOverride is passed', async () => {
      await analyzeGrammarWithGemini('key', 'Some essay content.');

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.model).toBeUndefined();
    });
  });

  describe('analyzeTransitionsWithGemini', () => {
    const essay = 'First sentence. Second sentence.\n\nThird sentence. Fourth sentence.';

    beforeEach(() => {
      // No weak/missing transitions => the contextual-recheck pass (pass 2) never
      // fires, so streamGeminiJson is called exactly once (the main analysis call).
      mockStreamGeminiJson.mockResolvedValue(
        JSON.stringify({ sentenceTransitions: [], paragraphTransitions: [], summary: 'ok' }),
      );
    });

    it('uses TRANSITION_SYSTEM_PROMPT when no opts are passed', async () => {
      // apiKey === '' forces the regex sentence-split fallback (falsy apiKey),
      // keeping this test independent of the Gemma sentence-splitter call layer.
      const sentences = await splitEssayIntoSentences(essay);
      const expectedContents = buildTransitionPrompt(formatSentencesForPrompt(sentences));

      await analyzeTransitionsWithGemini('', essay);

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe(TRANSITION_SYSTEM_PROMPT);
      expect(callArgs.contents).toBe(expectedContents);
    });

    it('replaces systemInstruction with the override on the main pass only, leaving user content unchanged', async () => {
      const sentences = await splitEssayIntoSentences(essay);
      const expectedContents = buildTransitionPrompt(formatSentencesForPrompt(sentences));

      await analyzeTransitionsWithGemini('', essay, undefined, null, {
        systemPromptOverride: 'OVERRIDDEN TRANSITION PROMPT',
      });

      // Only the main pass should have run (no flagged transitions => no recheck pass).
      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe('OVERRIDDEN TRANSITION PROMPT');
      expect(callArgs.contents).toBe(expectedContents);
    });

    it('does NOT apply the override to the contextual-recheck pass', async () => {
      // Force a flagged "weak" transition on pass 1 so pass 2 (recheck) fires.
      mockStreamGeminiJson
        .mockResolvedValueOnce(
          JSON.stringify({
            sentenceTransitions: [
              { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'weak', comment: 'Abrupt.' },
            ],
            paragraphTransitions: [],
            summary: 'ok',
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ results: [] }));

      await analyzeTransitionsWithGemini('', essay, undefined, null, {
        systemPromptOverride: 'OVERRIDDEN TRANSITION PROMPT',
      });

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(2);
      const mainCallArgs = mockStreamGeminiJson.mock.calls[0][0];
      const recheckCallArgs = mockStreamGeminiJson.mock.calls[1][0];
      expect(mainCallArgs.systemInstruction).toBe('OVERRIDDEN TRANSITION PROMPT');
      // The recheck pass keeps its own fixed system prompt regardless of override.
      expect(recheckCallArgs.systemInstruction).not.toBe('OVERRIDDEN TRANSITION PROMPT');
      expect(recheckCallArgs.systemInstruction).toContain('re-evaluating transition quality');
    });

    it('ignores an empty-string override', async () => {
      const sentences = await splitEssayIntoSentences(essay);
      const expectedContents = buildTransitionPrompt(formatSentencesForPrompt(sentences));

      await analyzeTransitionsWithGemini('', essay, undefined, null, { systemPromptOverride: '' });

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe(TRANSITION_SYSTEM_PROMPT);
      expect(callArgs.contents).toBe(expectedContents);
    });

    it('passes modelOverride through as the main pass\'s model option only', async () => {
      await analyzeTransitionsWithGemini('', essay, undefined, null, {
        modelOverride: 'gemini-3.5-flash',
      });

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-3.5-flash');
      expect(callArgs.systemInstruction).toBe(TRANSITION_SYSTEM_PROMPT);
    });

    it('does NOT apply modelOverride to the contextual-recheck pass', async () => {
      // Force a flagged "weak" transition on pass 1 so pass 2 (recheck) fires.
      mockStreamGeminiJson
        .mockResolvedValueOnce(
          JSON.stringify({
            sentenceTransitions: [
              { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'weak', comment: 'Abrupt.' },
            ],
            paragraphTransitions: [],
            summary: 'ok',
          }),
        )
        .mockResolvedValueOnce(JSON.stringify({ results: [] }));

      await analyzeTransitionsWithGemini('', essay, undefined, null, {
        modelOverride: 'gemini-3.5-flash',
      });

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(2);
      const mainCallArgs = mockStreamGeminiJson.mock.calls[0][0];
      const recheckCallArgs = mockStreamGeminiJson.mock.calls[1][0];
      expect(mainCallArgs.model).toBe('gemini-3.5-flash');
      expect(recheckCallArgs.model).toBeUndefined();
    });
  });

  describe('evaluateWithGemini', () => {
    beforeEach(() => {
      mockStreamGeminiJson.mockResolvedValue('{}');
    });

    it('uses SYSTEM_PROMPT when no opts are passed', async () => {
      await evaluateWithGemini('key', 'Evaluate this essay.');

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe(SYSTEM_PROMPT);
      expect(callArgs.contents).toBe('Evaluate this essay.');
    });

    it('replaces systemInstruction with the override, leaving the user prompt unchanged', async () => {
      await evaluateWithGemini('key', 'Evaluate this essay.', undefined, undefined, {
        systemPromptOverride: 'OVERRIDDEN OVERALL PROMPT',
      });

      expect(mockStreamGeminiJson).toHaveBeenCalledTimes(1);
      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe('OVERRIDDEN OVERALL PROMPT');
      expect(callArgs.contents).toBe('Evaluate this essay.');
    });

    it('ignores an empty-string override', async () => {
      await evaluateWithGemini('key', 'Evaluate this essay.', undefined, undefined, {
        systemPromptOverride: '',
      });

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.systemInstruction).toBe(SYSTEM_PROMPT);
    });

    it('still passes through the model param alongside opts', async () => {
      await evaluateWithGemini('key', 'Evaluate this essay.', undefined, 'gemini-custom-model', {
        systemPromptOverride: 'OVERRIDDEN OVERALL PROMPT',
      });

      const callArgs = mockStreamGeminiJson.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-custom-model');
      expect(callArgs.systemInstruction).toBe('OVERRIDDEN OVERALL PROMPT');
    });
  });
});
