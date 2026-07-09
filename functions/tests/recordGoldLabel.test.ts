import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors resubmitDraft.test.ts / submitEssay.test.ts's Firestore mocking
// idiom: a single mockDoc-by-path dispatcher, plus separate get/update/set
// spies per logical doc so each test can control run/item existence and
// assert on the writes independently.
const mockAllowlistGet = vi.fn();
const mockAdminsGet = vi.fn();
const mockRunGet = vi.fn();
const mockItemGet = vi.fn();
const mockItemUpdate = vi.fn().mockResolvedValue(undefined);
const mockGoldLabelSet = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (path === 'config/allowlist') return { get: mockAllowlistGet };
      if (path === 'config/admins') return { get: mockAdminsGet };
      throw new Error(`Unexpected db.doc() call in test: ${path}`);
    },
    collection: (name: string) => {
      if (name === 'evalRuns') {
        return {
          doc: () => ({
            get: mockRunGet,
            collection: (subName: string) => {
              if (subName === 'items') {
                return {
                  doc: () => ({ get: mockItemGet, update: mockItemUpdate }),
                };
              }
              throw new Error(`Unexpected subcollection in test: ${subName}`);
            },
          }),
        };
      }
      if (name === 'evalGoldLabels') {
        return {
          doc: () => ({ set: mockGoldLabelSet }),
        };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    },
  }),
}));

vi.mock('firebase-admin/app', () => ({ initializeApp: vi.fn() }));

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (handlerOrOpts: any, maybeHandler?: any) => maybeHandler ?? handlerOrOpts,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

import { recordGoldLabel } from '../src/recordGoldLabel';

const AUTH = { uid: 'u1', token: { email: 'admin@gmail.com' } };

describe('recordGoldLabel', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowlistGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['admin@gmail.com'] }),
    });
    mockAdminsGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['admin@gmail.com'] }),
    });
    mockRunGet.mockResolvedValue({
      exists: true,
      data: () => ({ report: 'grammar' }),
    });
    mockItemGet.mockResolvedValue({ exists: true, data: () => ({}) });
  });

  it('throws unauthenticated when no auth', async () => {
    await expect((recordGoldLabel as any)({ auth: null, data: {} })).rejects.toThrow('Must be signed in');
  });

  it('throws permission-denied when email is not on the allowlist', async () => {
    mockAllowlistGet.mockResolvedValue({ exists: true, data: () => ({ emails: ['other@gmail.com'] }) });
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'i1', winner: 'A' },
      })
    ).rejects.toThrow('allowlist');
  });

  it('throws permission-denied when caller is allowlisted but not an admin', async () => {
    mockAdminsGet.mockResolvedValue({ exists: true, data: () => ({ emails: ['someone-else@gmail.com'] }) });
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'i1', winner: 'A' },
      })
    ).rejects.toThrow('admin');
  });

  it('rejects an invalid winner value', async () => {
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'i1', winner: 'C' },
      })
    ).rejects.toThrow(/winner/i);
  });

  it('rejects a non-string note', async () => {
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'i1', winner: 'A', note: 42 },
      })
    ).rejects.toThrow(/note/i);
  });

  it('throws not-found when the run does not exist', async () => {
    mockRunGet.mockResolvedValue({ exists: false });
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'missing-run', itemId: 'i1', winner: 'A' },
      })
    ).rejects.toThrow(/not found/i);
  });

  it('throws not-found when the item does not exist', async () => {
    mockItemGet.mockResolvedValue({ exists: false });
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'missing-item', winner: 'A' },
      })
    ).rejects.toThrow(/not found/i);
  });

  it('writes goldLabel on the item and mirrors it to evalGoldLabels', async () => {
    const result = await (recordGoldLabel as any)({
      auth: AUTH,
      data: { runId: 'r1', itemId: 'i1', winner: 'B', note: 'Challenger caught a real error' },
    });

    expect(result).toEqual({ ok: true });

    expect(mockItemUpdate).toHaveBeenCalledTimes(1);
    const [itemUpdateArg] = mockItemUpdate.mock.calls[0];
    expect(itemUpdateArg.goldLabel).toMatchObject({
      winner: 'B',
      note: 'Challenger caught a real error',
      by: 'admin@gmail.com',
    });
    expect(typeof itemUpdateArg.goldLabel.ts).toBe('string');
    expect(() => new Date(itemUpdateArg.goldLabel.ts).toISOString()).not.toThrow();

    expect(mockGoldLabelSet).toHaveBeenCalledTimes(1);
    const [mirrorArg] = mockGoldLabelSet.mock.calls[0];
    expect(mirrorArg).toMatchObject({
      runId: 'r1',
      itemId: 'i1',
      report: 'grammar',
      winner: 'B',
      note: 'Challenger caught a real error',
      by: 'admin@gmail.com',
    });
    expect(typeof mirrorArg.ts).toBe('string');
  });

  it('omits note from both writes when not provided', async () => {
    await (recordGoldLabel as any)({
      auth: AUTH,
      data: { runId: 'r1', itemId: 'i1', winner: 'tie' },
    });

    const [itemUpdateArg] = mockItemUpdate.mock.calls[0];
    expect(itemUpdateArg.goldLabel).not.toHaveProperty('note');

    const [mirrorArg] = mockGoldLabelSet.mock.calls[0];
    expect(mirrorArg).not.toHaveProperty('note');
  });
});
