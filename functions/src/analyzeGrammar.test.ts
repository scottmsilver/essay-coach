import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── Mocks (vi.hoisted runs before mock hoisting) ───────────────────────

const { captured, MockHttpsError } = vi.hoisted(() => {
  const captured: { handler: ((request: unknown) => Promise<unknown>) | null } = { handler: null };
  class MockHttpsError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return { captured, MockHttpsError };
});

const mockGet = vi.fn();
const mockUpdate = vi.fn();
const mockEssayGet = vi.fn();
const mockDraftRef = {
  get: mockGet,
  update: mockUpdate,
  parent: { parent: { get: mockEssayGet } },
};
const mockDoc = vi.fn(() => mockDraftRef);
vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({ doc: mockDoc }),
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'test-api-key' }),
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: unknown, handler: (request: unknown) => Promise<unknown>) => {
    captured.handler = handler;
    return handler;
  },
  HttpsError: MockHttpsError,
}));

const mockIsEmailAllowed = vi.fn().mockResolvedValue(true);
vi.mock('./allowlist', () => ({
  isEmailAllowed: (...args: unknown[]) => mockIsEmailAllowed(...args),
}));

const mockResolveEssayOwner = vi.fn().mockResolvedValue('uid-123');
vi.mock('./resolveEssayOwner', () => ({
  resolveEssayOwner: (...args: unknown[]) => mockResolveEssayOwner(...args),
}));

const mockAnalyzeGrammar = vi.fn().mockResolvedValue({
  summary: { totalErrors: 3 },
});
vi.mock('./grammar', () => ({
  analyzeGrammarWithGemini: (...args: unknown[]) => mockAnalyzeGrammar(...args),
}));

// Import AFTER mocks — this triggers createAnalysisHandler → onCall → captured.handler
import './analyzeGrammar';

// ─── Helpers ────────────────────────────────────────────────────────────

function getHandler() {
  if (!captured.handler) throw new Error('Handler not captured');
  return captured.handler;
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    auth: { uid: 'uid-123', token: { email: 'test@test.com' } },
    data: { essayId: 'e1', draftId: 'd1' },
    ...overrides,
  };
}

// ─── Tests ──────────────────────────────────────────────────────────────

describe('analyzeGrammar (via createAnalysisHandler)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGet.mockResolvedValue({ exists: true, data: () => ({ content: 'Test essay.' }) });
    mockUpdate.mockResolvedValue(undefined);
    mockIsEmailAllowed.mockResolvedValue(true);
    mockResolveEssayOwner.mockResolvedValue('uid-123');
    mockAnalyzeGrammar.mockResolvedValue({ summary: { totalErrors: 3 } });
  });

  it('rejects unauthenticated requests', async () => {
    await expect(getHandler()(makeRequest({ auth: null }))).rejects.toThrow('Must be signed in');
  });

  it('rejects users not on allowlist', async () => {
    mockIsEmailAllowed.mockResolvedValue(false);
    await expect(getHandler()(makeRequest())).rejects.toThrow('not on the allowlist');
  });

  it('rejects missing essayId or draftId', async () => {
    await expect(getHandler()(makeRequest({ data: { essayId: 'e1' } }))).rejects.toThrow('required');
    await expect(getHandler()(makeRequest({ data: { draftId: 'd1' } }))).rejects.toThrow('required');
  });

  it('rejects when draft not found', async () => {
    mockGet.mockResolvedValue({ exists: false });
    await expect(getHandler()(makeRequest())).rejects.toThrow('not found');
  });

  it('rejects when draft has no content', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({ content: '' }) });
    await expect(getHandler()(makeRequest())).rejects.toThrow('no content');
  });

  it('calls analyzeGrammarWithGemini and writes result to Firestore', async () => {
    const result = await getHandler()(makeRequest());

    expect(mockAnalyzeGrammar).toHaveBeenCalledWith('test-api-key', 'Test essay.', mockDraftRef);
    expect(mockUpdate).toHaveBeenCalledWith({ grammarAnalysis: { summary: { totalErrors: 3 } }, grammarStatus: null });
    expect(result).toEqual({ summary: { totalErrors: 3 } });
  });

  it('retries once on SyntaxError', async () => {
    mockAnalyzeGrammar
      .mockRejectedValueOnce(new SyntaxError('bad json'))
      .mockResolvedValueOnce({ summary: { totalErrors: 1 } });

    const result = await getHandler()(makeRequest());
    expect(mockAnalyzeGrammar).toHaveBeenCalledTimes(2);
    expect(result).toEqual({ summary: { totalErrors: 1 } });
  });

  it('writes error status when analysis fails', async () => {
    mockAnalyzeGrammar.mockRejectedValue(new Error('Gemini down'));

    await expect(getHandler()(makeRequest())).rejects.toThrow('Failed to analyze grammar');
    expect(mockUpdate).toHaveBeenCalledWith({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
  });

  it('resolves essay owner for shared access', async () => {
    const req = makeRequest({ data: { essayId: 'e1', draftId: 'd1', ownerUid: 'other-uid' } });
    await getHandler()(req);
    expect(mockResolveEssayOwner).toHaveBeenCalledWith('uid-123', 'other-uid');
  });
});
