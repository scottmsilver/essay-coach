import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { createDraftEntity } from '../entities/draftEntity';
import type { DraftEntity } from '../entities/draftEntity';
import type { Draft } from '../types';

// ─── Mock state ──────────────────────────────────────────────────────

const mockCallableFn = vi.fn().mockResolvedValue({ data: {} });
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const mockHttpsCallable = vi.fn((..._args: any[]) => mockCallableFn);
vi.mock('firebase/functions', () => ({
  httpsCallable: (...args: any[]) => mockHttpsCallable(...args),
}));

const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);
vi.mock('firebase/firestore', () => ({
  doc: (...args: unknown[]) => args.join('/'),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
}));

vi.mock('../firebase', () => ({
  functions: { _name: 'mock-functions' },
  db: { _name: 'mock-db' },
}));

vi.mock('../utils/submitEssay', () => ({
  FUNCTION_TIMEOUT: 180_000,
}));

import { useAnalysisActions } from './useAnalysisActions';

// ─── Helpers ─────────────────────────────────────────────────────────

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'draft-1',
    draftNumber: 1,
    content: 'Test essay content.',
    submittedAt: new Date('2026-03-28T12:00:00Z'),
    evaluation: null,
    revisionStage: null,
    ...overrides,
  };
}

function makeEntity(overrides: Partial<Draft> = {}): DraftEntity {
  return createDraftEntity(makeDraft(overrides));
}

const defaultUser = { uid: 'user-1' };
const defaultEssayId = 'essay-1';

function renderActions(opts: {
  entity?: DraftEntity | null;
  essayId?: string;
  ownerUid?: string;
  user?: { uid: string } | null;
} = {}) {
  const {
    entity = makeEntity(),
    essayId = defaultEssayId,
    ownerUid = undefined,
    user = defaultUser,
  } = opts;
  return renderHook(() => useAnalysisActions(entity, essayId, ownerUid, user));
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('useAnalysisActions', () => {
  beforeEach(() => {
    mockCallableFn.mockClear().mockResolvedValue({ data: {} });
    mockHttpsCallable.mockClear().mockReturnValue(mockCallableFn);
    mockUpdateDoc.mockClear().mockResolvedValue(undefined);
  });

  describe('ensure', () => {
    it('skips when entity.analysisStatus returns "ready"', async () => {
      const entity = makeEntity({ grammarAnalysis: { summary: { totalErrors: 0, errorsByCategory: { commaSplices: 0, runOnSentences: 0, fragments: 0, subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0, parallelStructure: 0, punctuationErrors: 0, missingCommas: 0 }, overallComment: '', strengthAreas: [], priorityFixes: [] }, commaSplices: { locations: [] }, runOnSentences: { locations: [] }, fragments: { locations: [] }, subjectVerbAgreement: { locations: [] }, pronounReference: { locations: [] }, verbTenseConsistency: { locations: [] }, parallelStructure: { locations: [] }, punctuationErrors: { locations: [] }, missingCommas: { locations: [] }, sentenceVariety: { avgLength: 10, distribution: { simple: 1, compound: 1, complex: 1, compoundComplex: 0 }, comment: '' }, activePassiveVoice: { activeCount: 5, passiveCount: 1, passiveInstances: [] }, modifierPlacement: { issues: [] }, wordiness: { instances: [] } } });
      expect(entity.analysisStatus('grammar')).toBe('ready');

      const { result } = renderActions({ entity });
      await act(async () => {
        await result.current.ensure('grammar');
      });

      expect(mockHttpsCallable).not.toHaveBeenCalled();
    });

    it('skips when already loading (in-flight dedupe)', async () => {
      // Make the callable hang so loading stays true
      let resolveCallable!: () => void;
      mockCallableFn.mockReturnValue(new Promise<void>((r) => { resolveCallable = r; }));

      const { result } = renderActions();

      // Fire the first ensure — this will set loading[grammar] = true
      let firstPromise: Promise<void>;
      await act(async () => {
        firstPromise = result.current.ensure('grammar');
      });

      // Loading should be true now
      expect(result.current.loading.grammar).toBe(true);

      // Fire a second ensure — should be deduped
      await act(async () => {
        await result.current.ensure('grammar');
      });

      // Only one httpsCallable invocation
      expect(mockHttpsCallable).toHaveBeenCalledTimes(1);

      // Clean up: resolve the hanging promise
      await act(async () => {
        resolveCallable();
        await firstPromise!;
      });
    });

    it('fires httpsCallable when entity says "pending"', async () => {
      const entity = makeEntity(); // no data, no status = pending
      expect(entity.analysisStatus('grammar')).toBe('pending');

      const { result } = renderActions({ entity });
      await act(async () => {
        await result.current.ensure('grammar');
      });

      expect(mockHttpsCallable).toHaveBeenCalledTimes(1);
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        { _name: 'mock-functions' },
        'analyzeGrammar',
        { timeout: 180_000 },
      );
      expect(mockCallableFn).toHaveBeenCalledWith({
        essayId: 'essay-1',
        draftId: 'draft-1',
        ownerUid: undefined,
      });
    });

    it('fires when entity says "error" (allow retry)', async () => {
      const entity = makeEntity({
        grammarStatus: { stage: 'error', message: 'Something broke' },
      });
      expect(entity.analysisStatus('grammar')).toBe('error');

      const { result } = renderActions({ entity });
      await act(async () => {
        await result.current.ensure('grammar');
      });

      expect(mockHttpsCallable).toHaveBeenCalledTimes(1);
    });
  });

  describe('rerun', () => {
    it('calls updateDoc to clear fields, then httpsCallable', async () => {
      const { result } = renderActions();
      await act(async () => {
        await result.current.rerun('grammar');
      });

      // updateDoc should clear the data and status fields
      expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
      const [docRef, updateFields] = mockUpdateDoc.mock.calls[0];
      expect(docRef).toContain('draft-1');
      expect(updateFields).toEqual({ grammarAnalysis: null, grammarStatus: null });

      // Then httpsCallable should have been called
      expect(mockHttpsCallable).toHaveBeenCalledTimes(1);
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        { _name: 'mock-functions' },
        'analyzeGrammar',
        { timeout: 180_000 },
      );
    });
  });

  describe('rerunOverall', () => {
    it('calls evaluateEssay with force=true', async () => {
      const { result } = renderActions();
      await act(async () => {
        await result.current.rerunOverall();
      });

      expect(mockHttpsCallable).toHaveBeenCalledTimes(1);
      expect(mockHttpsCallable).toHaveBeenCalledWith(
        { _name: 'mock-functions' },
        'evaluateEssay',
        { timeout: 180_000 },
      );
      expect(mockCallableFn).toHaveBeenCalledWith({
        essayId: 'essay-1',
        draftId: 'draft-1',
        ownerUid: undefined,
        force: true,
      });
      expect(result.current.retrying).toBe(false);
    });

    it('increments retryCount on failure', async () => {
      mockCallableFn.mockRejectedValueOnce(new Error('Network error'));

      const { result } = renderActions();
      expect(result.current.retryCount).toBe(0);

      await act(async () => {
        await result.current.rerunOverall();
      });

      expect(result.current.retryCount).toBe(1);

      // Call again to verify it increments
      mockCallableFn.mockRejectedValueOnce(new Error('Network error'));
      await act(async () => {
        await result.current.rerunOverall();
      });

      expect(result.current.retryCount).toBe(2);
    });
  });

  describe('error handling', () => {
    it('sets error string on httpsCallable failure', async () => {
      mockCallableFn.mockRejectedValueOnce(new Error('Function timed out'));

      const { result } = renderActions();
      await act(async () => {
        await result.current.ensure('transitions');
      });

      expect(result.current.errors.transitions).toBe('Function timed out');
      expect(result.current.loading.transitions).toBe(false);
    });
  });
});
