import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin
const mockSet = vi.fn().mockResolvedValue(undefined);
const mockUpdate = vi.fn().mockResolvedValue(undefined);
const mockDoc = vi.fn().mockReturnValue({
  id: 'essay123',
  set: mockSet,
  update: mockUpdate,
  collection: () => ({
    doc: () => ({
      id: 'draft123',
      set: mockSet,
      update: mockUpdate,
    }),
  }),
});
const mockCollection = vi.fn().mockReturnValue({ doc: mockDoc });
const mockAllowlistGet = vi.fn();

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    collection: mockCollection,
    doc: (path: string) => {
      if (path === 'config/allowlist') {
        return { get: mockAllowlistGet };
      }
      return mockDoc(path);
    },
  }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

vi.mock('firebase-admin/app', () => ({
  initializeApp: vi.fn(),
}));

// Mock Gemini
const mockGenerateContent = vi.fn();
vi.mock('@google/genai', () => ({
  GoogleGenAI: vi.fn().mockImplementation(() => ({
    models: { generateContent: mockGenerateContent },
  })),
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

import { submitEssay } from '../src/submitEssay';

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

describe('submitEssay', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    mockGenerateContent.mockResolvedValue({
      text: JSON.stringify(mockEvaluation),
    });
  });

  it('throws unauthenticated when no auth', async () => {
    await expect(
      (submitEssay as any)({ auth: null, data: {} })
    ).rejects.toThrow('Must be signed in');
  });

  it('throws permission-denied when email not on allowlist', async () => {
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['other@gmail.com'] }),
    });
    await expect(
      (submitEssay as any)({
        auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
        data: { title: 'T', assignmentPrompt: 'P', writingType: 'argumentative', content: 'Essay text' },
      })
    ).rejects.toThrow('allowlist');
  });

  it('throws invalid-argument for bad input', async () => {
    await expect(
      (submitEssay as any)({
        auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
        data: { title: '', assignmentPrompt: 'P', writingType: 'argumentative', content: 'text' },
      })
    ).rejects.toThrow(/title/i);
  });

  it('creates essay and draft, calls Gemini, returns evaluation', async () => {
    const result = await (submitEssay as any)({
      auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
      data: {
        title: 'Hamlet Analysis',
        assignmentPrompt: 'Analyze Hamlet',
        writingType: 'analytical',
        content: 'Hamlet is a play about inaction.',
      },
    });

    expect(mockSet).toHaveBeenCalled();
    expect(mockGenerateContent).toHaveBeenCalled();
    expect(result.evaluation).toEqual(mockEvaluation);
  });
});
