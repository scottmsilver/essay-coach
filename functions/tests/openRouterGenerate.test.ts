import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { makeOpenRouterGenerateJson } from '../src/openRouterGenerate';

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

function chatResponse(content: string) {
  return {
    ok: true,
    json: async () => ({ choices: [{ message: { content } }] }),
  };
}

function errorResponse(status: number, bodyText: string) {
  return {
    ok: false,
    status,
    text: async () => bodyText,
  };
}

const OPTS = {
  contents: 'Essay text here.',
  systemInstruction: 'You are a grammar analyst.',
  responseSchema: { type: 'object', properties: {} },
};

describe('makeOpenRouterGenerateJson', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('happy path: posts to the chat/completions endpoint and returns the extracted JSON string', async () => {
    mockFetch.mockResolvedValueOnce(chatResponse('Here you go: {"summary": "ok"} trailing text'));

    const generate = makeOpenRouterGenerateJson('sk-or-fakekey123456', 'anthropic/claude-sonnet-4');
    const result = await generate(OPTS);

    expect(result).toBe('{"summary": "ok"} trailing text'.match(/\{[\s\S]*\}/)![0]);
    expect(JSON.parse(result)).toEqual({ summary: 'ok' });
    expect(mockFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toBe('Bearer sk-or-fakekey123456');
    const body = JSON.parse(init.body);
    expect(body.model).toBe('anthropic/claude-sonnet-4');
    expect(body.messages).toHaveLength(2);
    expect(body.messages[0].role).toBe('system');
    expect(body.messages[0].content).toContain('You are a grammar analyst.');
    expect(body.messages[0].content).toContain('Respond ONLY with a JSON object matching this JSON schema:');
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Essay text here.' });
    expect(body.response_format).toEqual({ type: 'json_object' });
  });

  it('retries on a malformed (no-JSON) response, then succeeds on the second attempt', async () => {
    mockFetch
      .mockResolvedValueOnce(chatResponse('no json here at all'))
      .mockResolvedValueOnce(chatResponse('{"ok": true}'));

    const generate = makeOpenRouterGenerateJson('fake-key', 'openai/gpt-5');
    const promise = generate(OPTS);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('{"ok": true}');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('falls back to no response_format when the API rejects it with a 4xx mentioning response_format', async () => {
    mockFetch
      .mockResolvedValueOnce(errorResponse(400, 'Error: response_format is not supported for this model'))
      .mockResolvedValueOnce(chatResponse('{"ok": true}'));

    const generate = makeOpenRouterGenerateJson('fake-key', 'meta-llama/llama-3');
    const promise = generate(OPTS);
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(result).toBe('{"ok": true}');
    expect(mockFetch).toHaveBeenCalledTimes(2);

    const firstBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(firstBody.response_format).toEqual({ type: 'json_object' });
    const secondBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(secondBody.response_format).toBeUndefined();
  });

  it('gives up after 3 attempts and throws, redacting an sk-or-shaped API key from the message', async () => {
    mockFetch.mockResolvedValue(errorResponse(500, 'internal error'));

    const apiKey = 'sk-or-v1-supersecretkeymaterial';
    const generate = makeOpenRouterGenerateJson(apiKey, 'openai/gpt-5');
    const promise = generate(OPTS);
    // Attach a handler synchronously so Node never sees this as an
    // unhandled rejection while the fake timers advance below.
    promise.catch(() => {});
    await vi.runAllTimersAsync();

    const caught = await promise.catch((err) => err as Error);
    expect(caught).toBeInstanceOf(Error);
    expect(caught.message).not.toContain(apiKey);
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });
});
