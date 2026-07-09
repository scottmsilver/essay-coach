import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mirrors resubmitDraft.test.ts / submitEssay.test.ts's Firestore mocking
// idiom: a single mockDoc-by-path dispatcher, plus separate get/update/set
// spies per logical doc so each test can control run/item existence and
// assert on the writes independently.
//
// The item update and the evalGoldLabels mirror write happen in a single
// atomic WriteBatch, so both are captured via shared `mockBatchUpdate` /
// `mockBatchSet` / `mockBatchCommit` spies (one `db.batch()` per call). Each
// `.doc()` call below carries a `path` so tests can assert *which* doc a
// batch operation targeted — in particular that the evalGoldLabels mirror
// always resolves to the deterministic `${runId}_${itemId}` doc, never an
// auto-id.
const mockAllowlistGet = vi.fn();
const mockAdminsGet = vi.fn();
const mockRunGet = vi.fn();
const mockItemGet = vi.fn();
const mockBatchUpdate = vi.fn();
const mockBatchSet = vi.fn();
const mockBatchCommit = vi.fn().mockResolvedValue(undefined);

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
          doc: (runId: string) => ({
            path: `evalRuns/${runId}`,
            get: mockRunGet,
            collection: (subName: string) => {
              if (subName === 'items') {
                return {
                  doc: (itemId: string) => ({
                    path: `evalRuns/${runId}/items/${itemId}`,
                    get: mockItemGet,
                  }),
                };
              }
              throw new Error(`Unexpected subcollection in test: ${subName}`);
            },
          }),
        };
      }
      if (name === 'evalGoldLabels') {
        return {
          doc: (id: string) => ({ path: `evalGoldLabels/${id}` }),
        };
      }
      throw new Error(`Unexpected collection in test: ${name}`);
    },
    batch: () => ({
      update: mockBatchUpdate,
      set: mockBatchSet,
      commit: mockBatchCommit,
    }),
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

  it('rejects a runId containing a slash (path-traversal-shaped id)', async () => {
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'a/b', itemId: 'i1', winner: 'A' },
      })
    ).rejects.toThrow(/runId/i);
  });

  it('rejects an itemId containing a slash (path-traversal-shaped id)', async () => {
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'a/b', winner: 'A' },
      })
    ).rejects.toThrow(/itemId/i);
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

  it('throws failed-precondition when the run is missing a valid report field', async () => {
    mockRunGet.mockResolvedValue({ exists: true, data: () => ({}) });
    await expect(
      (recordGoldLabel as any)({
        auth: AUTH,
        data: { runId: 'r1', itemId: 'i1', winner: 'A' },
      })
    ).rejects.toThrow(/report/i);

    expect(mockBatchUpdate).not.toHaveBeenCalled();
    expect(mockBatchSet).not.toHaveBeenCalled();
    expect(mockBatchCommit).not.toHaveBeenCalled();
  });

  it('writes goldLabel on the item and mirrors it to evalGoldLabels in a single atomic batch', async () => {
    const result = await (recordGoldLabel as any)({
      auth: AUTH,
      data: { runId: 'r1', itemId: 'i1', winner: 'B', note: 'Challenger caught a real error' },
    });

    expect(result).toEqual({ ok: true });

    expect(mockBatchUpdate).toHaveBeenCalledTimes(1);
    const [itemRefArg, itemUpdateArg] = mockBatchUpdate.mock.calls[0];
    expect(itemRefArg.path).toBe('evalRuns/r1/items/i1');
    expect(itemUpdateArg.goldLabel).toMatchObject({
      winner: 'B',
      note: 'Challenger caught a real error',
      by: 'admin@gmail.com',
    });
    expect(typeof itemUpdateArg.goldLabel.ts).toBe('string');
    expect(() => new Date(itemUpdateArg.goldLabel.ts).toISOString()).not.toThrow();

    expect(mockBatchSet).toHaveBeenCalledTimes(1);
    const [mirrorRefArg, mirrorArg] = mockBatchSet.mock.calls[0];
    // Deterministic mirror doc id — never an auto-id.
    expect(mirrorRefArg.path).toBe('evalGoldLabels/r1_i1');
    expect(mirrorArg).toMatchObject({
      runId: 'r1',
      itemId: 'i1',
      report: 'grammar',
      winner: 'B',
      note: 'Challenger caught a real error',
      by: 'admin@gmail.com',
    });
    expect(typeof mirrorArg.ts).toBe('string');

    expect(mockBatchCommit).toHaveBeenCalledTimes(1);
  });

  it('relabeling the same item upserts the same deterministic mirror doc (no duplicate ids)', async () => {
    await (recordGoldLabel as any)({
      auth: AUTH,
      data: { runId: 'r1', itemId: 'i1', winner: 'A' },
    });
    await (recordGoldLabel as any)({
      auth: AUTH,
      data: { runId: 'r1', itemId: 'i1', winner: 'B', note: 'changed my mind after re-reading' },
    });

    expect(mockBatchSet).toHaveBeenCalledTimes(2);
    const [firstMirrorRefArg] = mockBatchSet.mock.calls[0];
    const [secondMirrorRefArg] = mockBatchSet.mock.calls[1];
    expect(firstMirrorRefArg.path).toBe('evalGoldLabels/r1_i1');
    expect(secondMirrorRefArg.path).toBe('evalGoldLabels/r1_i1');
    expect(firstMirrorRefArg.path).toBe(secondMirrorRefArg.path);

    expect(mockBatchUpdate).toHaveBeenCalledTimes(2);
    expect(mockBatchCommit).toHaveBeenCalledTimes(2);
  });

  it('omits note from both writes when not provided', async () => {
    await (recordGoldLabel as any)({
      auth: AUTH,
      data: { runId: 'r1', itemId: 'i1', winner: 'tie' },
    });

    const [, itemUpdateArg] = mockBatchUpdate.mock.calls[0];
    expect(itemUpdateArg.goldLabel).not.toHaveProperty('note');

    const [, mirrorArg] = mockBatchSet.mock.calls[0];
    expect(mirrorArg).not.toHaveProperty('note');
  });
});
