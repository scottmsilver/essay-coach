import { describe, it, expect, vi, beforeEach } from 'vitest';

const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockEssayGet = vi.fn();
const mockDraftsGet = vi.fn();
const mockAllowlistGet = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (path === 'config/allowlist') return { get: mockAllowlistGet };
      return {
        get: mockEssayGet,
        update: mockUpdate,
        collection: () => ({
          doc: () => ({ id: 'newdraft1', set: mockSet, update: mockUpdate }),
          where: () => ({ limit: () => ({ get: mockDraftsGet }) }),
        }),
      };
    },
  }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));

const mockGenerateContentStream = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContentStream: mockGenerateContentStream },
  })),
}));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: any, handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: () => ({ value: () => 'fake-api-key' }),
}));

import { resubmitDraft } from '../src/resubmitDraft';

const mockEvaluation = {
  traits: {
    ideas: { score: 5, feedback: 'Improved', revisionPriority: null, annotations: [] },
    organization: { score: 4, feedback: 'Better', revisionPriority: null, annotations: [] },
    voice: { score: 5, feedback: 'Great', revisionPriority: null, annotations: [] },
    wordChoice: { score: 4, feedback: 'Improved', revisionPriority: null, annotations: [] },
    sentenceFluency: { score: 4, feedback: 'Solid', revisionPriority: null, annotations: [] },
    conventions: { score: 4, feedback: 'Fixed', revisionPriority: null, annotations: [] },
    presentation: { score: 4, feedback: 'Fine', revisionPriority: null, annotations: [] },
  },
  overallFeedback: 'Much improved',
  revisionPlan: [],
  comparisonToPrevious: {
    scoreChanges: { conventions: { previous: 2, current: 4, delta: 2 } },
    improvements: ['Conventions improved'],
    remainingIssues: [],
  },
};

describe('resubmitDraft', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    mockEssayGet.mockResolvedValue({
      exists: true,
      data: () => ({
        assignmentPrompt: 'Analyze Hamlet',
        writingType: 'analytical',
        currentDraftNumber: 1,
      }),
    });
    mockDraftsGet.mockResolvedValue({
      empty: false,
      docs: [{ data: () => ({ evaluation: { traits: {} } }) }],
    });
    mockGenerateContentStream.mockResolvedValue({
      [Symbol.asyncIterator]: async function* () {
        yield { candidates: [{ content: { parts: [{ text: JSON.stringify(mockEvaluation) }] } }] };
      },
    });
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(
      (resubmitDraft as any)({ auth: null, data: {} })
    ).rejects.toThrow('Must be signed in');
  });

  it('throws not-found when essay does not exist', async () => {
    mockEssayGet.mockResolvedValue({ exists: false });
    await expect(
      (resubmitDraft as any)({
        auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
        data: { essayId: 'nonexistent', content: 'Revised text' },
      })
    ).rejects.toThrow('not found');
  });

  it('creates new draft and returns evaluation with comparison', async () => {
    const result = await (resubmitDraft as any)({
      auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
      data: { essayId: 'essay1', content: 'My revised essay text.' },
    });

    expect(mockSet).toHaveBeenCalled();
    expect(mockUpdate).toHaveBeenCalled();
    expect(mockGenerateContentStream).toHaveBeenCalled();
    expect(result.draftNumber).toBe(2);
    expect(result.evaluation.comparisonToPrevious).toBeTruthy();
  });
});
