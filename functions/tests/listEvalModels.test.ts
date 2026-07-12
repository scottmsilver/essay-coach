import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors recordGoldLabel.test.ts's onCall/HttpsError mock and
// analyzeGrammar.test.ts's allowlist/admins module mocks — mocking the
// modules directly (rather than going through firebase-admin/firestore) is
// enough here since listEvalModels only calls isEmailAllowed/isEmailAdmin,
// never Firestore itself.
const { mockIsEmailAllowed, mockIsEmailAdmin } = vi.hoisted(() => ({
  mockIsEmailAllowed: vi.fn(),
  mockIsEmailAdmin: vi.fn(),
}));

vi.mock('../src/allowlist', () => ({
  isEmailAllowed: (...args: unknown[]) => mockIsEmailAllowed(...args),
}));
vi.mock('../src/admins', () => ({
  isEmailAdmin: (...args: unknown[]) => mockIsEmailAdmin(...args),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handlerOrOpts: any, maybeHandler?: any) => maybeHandler ?? handlerOrOpts,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

// Shaped like a real Gemini key (AIza... prefix) so this test exercises the
// same redaction path (redactEvalError's bare-AIza-key rule) that would fire
// on an actual production key, rather than a synthetic string that happens
// not to match any of redactEvalError's patterns.
const FAKE_API_KEY = 'AIzaSyFAKEKEY1234567890abcdefghijk';

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => FAKE_API_KEY }),
}));

const { mockLoggerError } = vi.hoisted(() => ({ mockLoggerError: vi.fn() }));
vi.mock('firebase-functions/v2', () => ({
  logger: { error: mockLoggerError, info: vi.fn() },
}));

// listEvalModels.ts imports redactEvalError from ../src/evalRun. evalRun.ts
// itself calls defineSecret/onCall at module scope (mocked above) and only
// calls getFirestore() inside its own onCall handler body — which this test
// never invokes — so no firebase-admin/firestore mock is needed here (same
// as evalRun.test.ts, which imports evalRun.ts with no Firestore mock at all).

const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

import { listEvalModels } from '../src/listEvalModels';

const AUTH = { uid: 'u1', token: { email: 'admin@gmail.com' } };
const API_KEY = FAKE_API_KEY;

function modelsResponse(models: Array<{ name: string; supportedGenerationMethods?: string[] }>, nextPageToken?: string) {
  return {
    ok: true,
    json: async () => ({ models, ...(nextPageToken ? { nextPageToken } : {}) }),
  };
}

describe('listEvalModels', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEmailAllowed.mockResolvedValue(true);
    mockIsEmailAdmin.mockResolvedValue(true);
  });

  it('throws unauthenticated when no auth', async () => {
    await expect((listEvalModels as any)({ auth: null, data: {} })).rejects.toThrow('Must be signed in');
  });

  it('throws permission-denied when caller is allowlisted but not an admin', async () => {
    mockIsEmailAdmin.mockResolvedValue(false);
    await expect((listEvalModels as any)({ auth: AUTH, data: {} })).rejects.toThrow(/admin/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('throws permission-denied when email is not on the allowlist', async () => {
    mockIsEmailAllowed.mockResolvedValue(false);
    await expect((listEvalModels as any)({ auth: AUTH, data: {} })).rejects.toThrow(/allowlist/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('happy path: filters out models missing generateContent and strips the models/ prefix', async () => {
    mockFetch.mockResolvedValueOnce(
      modelsResponse([
        { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent', 'countTokens'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/embedding-001', supportedGenerationMethods: ['embedContent'] },
      ])
    );

    const result = await (listEvalModels as any)({ auth: AUTH, data: {} });

    expect(result).toEqual({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] });
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('generativelanguage.googleapis.com/v1beta/models');
    expect(url).toContain(`key=${API_KEY}`);
    expect(url).toContain('pageSize=200');
  });

  it('dedupes and sorts model ids', async () => {
    mockFetch.mockResolvedValueOnce(
      modelsResponse([
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-1.5-flash', supportedGenerationMethods: ['generateContent'] },
        { name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] },
      ])
    );

    const result = await (listEvalModels as any)({ auth: AUTH, data: {} });

    expect(result).toEqual({ models: ['gemini-1.5-flash', 'gemini-2.5-pro'] });
  });

  it('merges two pages when nextPageToken is present', async () => {
    mockFetch
      .mockResolvedValueOnce(
        modelsResponse(
          [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }],
          'PAGE_2_TOKEN'
        )
      )
      .mockResolvedValueOnce(
        modelsResponse([{ name: 'models/gemini-2.5-pro', supportedGenerationMethods: ['generateContent'] }])
      );

    const result = await (listEvalModels as any)({ auth: AUTH, data: {} });

    expect(result).toEqual({ models: ['gemini-2.5-flash', 'gemini-2.5-pro'] });
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const secondUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondUrl).toContain('pageToken=PAGE_2_TOKEN');
  });

  it('stops after MAX_PAGES (3) even if nextPageToken keeps being returned', async () => {
    mockFetch
      .mockResolvedValueOnce(modelsResponse([{ name: 'models/m1', supportedGenerationMethods: ['generateContent'] }], 'T1'))
      .mockResolvedValueOnce(modelsResponse([{ name: 'models/m2', supportedGenerationMethods: ['generateContent'] }], 'T2'))
      .mockResolvedValueOnce(modelsResponse([{ name: 'models/m3', supportedGenerationMethods: ['generateContent'] }], 'T3'));

    const result = await (listEvalModels as any)({ auth: AUTH, data: {} });

    expect(mockFetch).toHaveBeenCalledTimes(3);
    expect(result).toEqual({ models: ['m1', 'm2', 'm3'] });
  });

  it('upstream 500 raises HttpsError(unavailable) whose message never contains the API key', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => `Internal error for key=${API_KEY}`,
    });

    let caught: any;
    try {
      await (listEvalModels as any)({ auth: AUTH, data: {} });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('unavailable');
    expect(caught.message).not.toContain(API_KEY);
    expect(caught.message.toLowerCase()).not.toContain('key=');

    // Full detail goes to logger.error, but only after the key material is redacted.
    expect(mockLoggerError).toHaveBeenCalledTimes(1);
    const loggedPayload = JSON.stringify(mockLoggerError.mock.calls[0]);
    expect(loggedPayload).not.toContain(API_KEY);
  });

  it('upstream network failure (fetch rejects) also raises a generic HttpsError(unavailable)', async () => {
    mockFetch.mockRejectedValueOnce(new Error(`fetch failed: ...?key=${API_KEY}`));

    let caught: any;
    try {
      await (listEvalModels as any)({ auth: AUTH, data: {} });
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('unavailable');
    expect(caught.message).not.toContain(API_KEY);
  });
});
