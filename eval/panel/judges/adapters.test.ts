import { describe, it, expect, vi } from 'vitest';
import { makeAnthropicJudge } from './anthropic';
import { makeOpenAIJudge } from './openai';
import { makeGoogleJudge } from './google';

describe('makeAnthropicJudge', () => {
  it('sends the prompt to the mock client and parses the result', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"correctness":{"score":5,"rationale":"great"}}' }],
    });
    const judge = makeAnthropicJudge({
      client: { messages: { create } } as any,
      model: 'claude-opus-4-8',
      dims: ['correctness'],
    });

    const result = await judge.judgeDimensional('PROMPT_TEXT');

    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-opus-4-8');
    expect(callArgs.max_tokens).toBe(600);
    expect(callArgs.temperature).toBeUndefined();
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'PROMPT_TEXT' }]);
    expect(result.dimensions.correctness.score).toBe(5);
  });

  it('sends the prompt for a pairwise judgment and parses the result', async () => {
    const create = vi.fn().mockResolvedValue({
      content: [{ type: 'text', text: '{"winner":"A","rationale":"clearer"}' }],
    });
    const judge = makeAnthropicJudge({
      client: { messages: { create } } as any,
      model: 'claude-opus-4-8',
      dims: [],
    });

    const result = await judge.judgePairwise('COMPARE_PROMPT');

    expect(create).toHaveBeenCalledTimes(1);
    expect(create.mock.calls[0][0].messages).toEqual([{ role: 'user', content: 'COMPARE_PROMPT' }]);
    expect(result.winner).toBe('A');
  });

  it('has the expected id and lab', () => {
    const judge = makeAnthropicJudge({ client: {} as any, model: 'claude-opus-4-8', dims: [] });
    expect(judge.lab).toBe('anthropic');
    expect(judge.id).toBe('anthropic:claude-opus-4-8');
  });
});

describe('makeOpenAIJudge', () => {
  it('sends the prompt to the mock client and parses the result', async () => {
    const create = vi.fn().mockResolvedValue({
      choices: [{ message: { content: '{"coverage":{"score":3,"rationale":"meh"}}' } }],
    });
    const judge = makeOpenAIJudge({
      client: { chat: { completions: { create } } } as any,
      model: 'gpt-5',
      dims: ['coverage'],
    });

    const result = await judge.judgeDimensional('PROMPT_TEXT');

    expect(create).toHaveBeenCalledTimes(1);
    const callArgs = create.mock.calls[0][0];
    expect(callArgs.model).toBe('gpt-5');
    expect(callArgs.max_completion_tokens).toBe(600);
    expect(callArgs.messages).toEqual([{ role: 'user', content: 'PROMPT_TEXT' }]);
    expect(result.dimensions.coverage.score).toBe(3);
  });

  it('has the expected id and lab', () => {
    const judge = makeOpenAIJudge({ client: {} as any, model: 'gpt-5', dims: [] });
    expect(judge.lab).toBe('openai');
    expect(judge.id).toBe('openai:gpt-5');
  });
});

describe('makeGoogleJudge', () => {
  it('sends the prompt to the mock client and parses the result', async () => {
    const generateContent = vi.fn().mockResolvedValue({
      text: '{"winner":"tie","rationale":"equal"}',
    });
    const judge = makeGoogleJudge({
      client: { models: { generateContent } } as any,
      model: 'gemini-2.5-pro',
      dims: [],
    });

    const result = await judge.judgePairwise('COMPARE_PROMPT');

    expect(generateContent).toHaveBeenCalledTimes(1);
    const callArgs = generateContent.mock.calls[0][0];
    expect(callArgs.model).toBe('gemini-2.5-pro');
    expect(callArgs.contents).toBe('COMPARE_PROMPT');
    expect(result.winner).toBe('tie');
  });

  it('has the expected id and lab', () => {
    const judge = makeGoogleJudge({ client: {} as any, model: 'gemini-2.5-pro', dims: [] });
    expect(judge.lab).toBe('google');
    expect(judge.id).toBe('google:gemini-2.5-pro');
  });
});
