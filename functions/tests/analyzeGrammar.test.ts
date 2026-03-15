import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockGet = vi.fn();
const mockDocRef = vi.fn().mockReturnValue({
  get: mockGet,
  update: mockUpdate,
});

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: mockDocRef,
  }),
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

// Mock firebase-functions
vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: any, handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'fake-api-key' }),
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));

// Mock allowlist and grammar modules
const mockIsEmailAllowed = vi.fn();
vi.mock('../src/allowlist', () => ({
  isEmailAllowed: (...args: any[]) => mockIsEmailAllowed(...args),
}));

const mockAnalyzeGrammarWithGemini = vi.fn();
vi.mock('../src/grammar', () => ({
  analyzeGrammarWithGemini: (...args: any[]) => mockAnalyzeGrammarWithGemini(...args),
}));

import { analyzeGrammar } from '../src/analyzeGrammar';

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
  summary: { totalErrors: 0, errorsByCategory: { commaSplices: 0, runOnSentences: 0, fragments: 0, subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0, parallelStructure: 0, punctuationErrors: 0, missingCommas: 0 }, overallComment: 'Clean writing.', strengthAreas: ['Good grammar'], priorityFixes: [] },
};

const makeRequest = (overrides = {}) => ({
  auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
  data: { essayId: 'e1', draftId: 'd1' },
  ...overrides,
});

describe('analyzeGrammar', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsEmailAllowed.mockResolvedValue(true);
    mockGet.mockResolvedValue({ exists: true, data: () => ({ content: 'Test essay content.' }) });
    mockAnalyzeGrammarWithGemini.mockResolvedValue(mockAnalysis);
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(
      (analyzeGrammar as any)(makeRequest({ auth: null }))
    ).rejects.toThrow('Must be signed in');
  });

  it('throws permission-denied when email not on allowlist', async () => {
    mockIsEmailAllowed.mockResolvedValue(false);
    await expect(
      (analyzeGrammar as any)(makeRequest())
    ).rejects.toThrow('allowlist');
  });

  it('throws invalid-argument when essayId or draftId missing', async () => {
    await expect(
      (analyzeGrammar as any)(makeRequest({ data: { essayId: '', draftId: 'd1' } }))
    ).rejects.toThrow('essayId and draftId are required');

    await expect(
      (analyzeGrammar as any)(makeRequest({ data: { essayId: 'e1', draftId: '' } }))
    ).rejects.toThrow('essayId and draftId are required');

    await expect(
      (analyzeGrammar as any)(makeRequest({ data: {} }))
    ).rejects.toThrow('essayId and draftId are required');
  });

  it('throws not-found when draft does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    await expect(
      (analyzeGrammar as any)(makeRequest())
    ).rejects.toThrow('Draft not found');
  });

  it('throws invalid-argument when draft has no content', async () => {
    mockGet.mockResolvedValue({ exists: true, data: () => ({}) });
    await expect(
      (analyzeGrammar as any)(makeRequest())
    ).rejects.toThrow('Draft has no content');
  });

  it('calls analyzeGrammarWithGemini and saves result on success', async () => {
    const result = await (analyzeGrammar as any)(makeRequest());

    expect(mockDocRef).toHaveBeenCalledWith('users/u1/essays/e1/drafts/d1');
    expect(mockAnalyzeGrammarWithGemini).toHaveBeenCalledWith(
      'fake-api-key',
      'Test essay content.',
      expect.anything(),
    );
    expect(mockUpdate).toHaveBeenCalledWith({ grammarAnalysis: mockAnalysis, grammarStatus: null });
    expect(result).toEqual(mockAnalysis);
  });

  it('retries on SyntaxError and succeeds', async () => {
    mockAnalyzeGrammarWithGemini
      .mockRejectedValueOnce(new SyntaxError('Unexpected token'))
      .mockResolvedValueOnce(mockAnalysis);

    const result = await (analyzeGrammar as any)(makeRequest());

    expect(mockAnalyzeGrammarWithGemini).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith({ grammarAnalysis: mockAnalysis, grammarStatus: null });
    expect(result).toEqual(mockAnalysis);
  });

  it('retries on SyntaxError, retry also fails, sets error status', async () => {
    mockAnalyzeGrammarWithGemini
      .mockRejectedValueOnce(new SyntaxError('Unexpected token'))
      .mockRejectedValueOnce(new Error('Still broken'));

    await expect(
      (analyzeGrammar as any)(makeRequest())
    ).rejects.toThrow('Failed to analyze grammar. Please try again.');

    expect(mockAnalyzeGrammarWithGemini).toHaveBeenCalledTimes(2);
    expect(mockUpdate).toHaveBeenCalledWith({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
  });

  it('sets error status on non-SyntaxError failure', async () => {
    mockAnalyzeGrammarWithGemini.mockRejectedValueOnce(new Error('Network timeout'));

    await expect(
      (analyzeGrammar as any)(makeRequest())
    ).rejects.toThrow('Failed to analyze grammar: Network timeout');

    expect(mockAnalyzeGrammarWithGemini).toHaveBeenCalledTimes(1);
    expect(mockUpdate).toHaveBeenCalledWith({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
  });
});
