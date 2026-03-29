import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type { Draft } from '../types';

// ─── Firebase mocks ──────────────────────────────────────────────────

const mockUpdateDoc = vi.fn().mockResolvedValue(undefined);

vi.mock('firebase/firestore', () => ({
  doc: vi.fn((_db: unknown, path: string) => `mock-ref:${path}`),
  updateDoc: (...args: unknown[]) => mockUpdateDoc(...args),
  serverTimestamp: () => 'mock-server-timestamp',
}));

vi.mock('../firebase', () => ({
  db: 'mock-db',
}));

// ─── Helpers ─────────────────────────────────────────────────────────

import { useDraftEditor } from './useDraftEditor';

const makeDraft = (overrides: Partial<Draft> = {}): Draft => ({
  id: 'd1',
  draftNumber: 1,
  content: 'Original essay content',
  submittedAt: new Date('2025-01-01'),
  evaluation: null,
  revisionStage: null,
  ...overrides,
});

const defaultUser = { uid: 'user1' };

// ─── Tests ───────────────────────────────────────────────────────────

describe('useDraftEditor', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    mockUpdateDoc.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Init ---

  it('initializes content from activeDraft.content', () => {
    const draft = makeDraft({ content: 'Hello world' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );
    expect(result.current.content).toBe('Hello world');
  });

  it('initializes lastSaved from activeDraft.editedAt', () => {
    const editedAt = new Date('2025-06-15T12:00:00Z');
    const draft = makeDraft({ editedAt });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );
    expect(result.current.lastSaved).toEqual(editedAt);
  });

  it('initializes lastSaved as null when editedAt is undefined', () => {
    const draft = makeDraft();
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );
    expect(result.current.lastSaved).toBeNull();
  });

  // --- Draft switch ---

  it('resets content when draft switches', () => {
    const draft1 = makeDraft({ id: 'd1', content: 'Draft 1 text' });
    const draft2 = makeDraft({ id: 'd2', content: 'Draft 2 text' });

    const { result, rerender } = renderHook(
      ({ draft }) => useDraftEditor(draft, 'e1', defaultUser, undefined, true),
      { initialProps: { draft: draft1 } },
    );

    expect(result.current.content).toBe('Draft 1 text');

    rerender({ draft: draft2 });
    expect(result.current.content).toBe('Draft 2 text');
  });

  it('clears autosave timer on draft switch (no stale save)', async () => {
    const draft1 = makeDraft({ id: 'd1', content: 'Draft 1 text' });
    const draft2 = makeDraft({ id: 'd2', content: 'Draft 2 text' });

    const { result, rerender } = renderHook(
      ({ draft }) => useDraftEditor(draft, 'e1', defaultUser, undefined, true),
      { initialProps: { draft: draft1 } },
    );

    // Start editing draft 1 — triggers 3s autosave
    act(() => {
      result.current.onChange('Draft 1 edited');
    });

    // Switch to draft 2 before the 3s fires
    rerender({ draft: draft2 });

    // Advance past the 3s timer
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    // The old draft's save should NOT have fired
    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  // --- onChange ---

  it('updates content state on onChange', () => {
    const draft = makeDraft();
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );

    act(() => {
      result.current.onChange('New content');
    });

    expect(result.current.content).toBe('New content');
  });

  it('triggers autosave after 3 seconds', async () => {
    const draft = makeDraft({ content: 'Original' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );

    act(() => {
      result.current.onChange('Edited content');
    });

    // Not called yet at 2s
    await act(async () => {
      vi.advanceTimersByTime(2000);
    });
    expect(mockUpdateDoc).not.toHaveBeenCalled();

    // Called after 3s total
    await act(async () => {
      vi.advanceTimersByTime(1500);
    });
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.stringContaining('users/user1/essays/e1/drafts/d1'),
      { content: 'Edited content', editedAt: 'mock-server-timestamp' },
    );
  });

  // --- Stale draftId protection ---

  it('captures correct draftId at call time via ref', async () => {
    const draft1 = makeDraft({ id: 'd1', content: 'Draft 1' });
    const draft2 = makeDraft({ id: 'd2', content: 'Draft 2' });

    const { result, rerender } = renderHook(
      ({ draft }) => useDraftEditor(draft, 'e1', defaultUser, undefined, true),
      { initialProps: { draft: draft1 } },
    );

    // Edit draft 1
    act(() => {
      result.current.onChange('Draft 1 edited');
    });

    // Switch to draft 2 and edit it
    rerender({ draft: draft2 });
    act(() => {
      result.current.onChange('Draft 2 edited');
    });

    // Advance past timer — only draft2's save should fire with draft2's id
    await act(async () => {
      vi.advanceTimersByTime(4000);
    });

    // Draft 1's timer was cleared by draft switch, only draft 2's save fires
    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.stringContaining('drafts/d2'),
      expect.objectContaining({ content: 'Draft 2 edited' }),
    );
  });

  // --- save() explicit ---

  it('save() calls updateDoc immediately', async () => {
    const draft = makeDraft({ content: 'Original' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );

    act(() => {
      result.current.onChange('Changed content');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockUpdateDoc).toHaveBeenCalledTimes(1);
    expect(mockUpdateDoc).toHaveBeenCalledWith(
      expect.stringContaining('drafts/d1'),
      { content: 'Changed content', editedAt: 'mock-server-timestamp' },
    );
  });

  it('save() skips if not latest draft', async () => {
    const draft = makeDraft({ content: 'Original' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, false),
    );

    act(() => {
      result.current.onChange('Changed');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('save() skips if viewer (ownerUid set)', async () => {
    const draft = makeDraft({ content: 'Original' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, 'other-uid', true),
    );

    act(() => {
      result.current.onChange('Changed');
    });

    await act(async () => {
      await result.current.save();
    });

    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  it('save() skips if content unchanged', async () => {
    const draft = makeDraft({ content: 'Original essay content' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );

    // Don't change content, just save
    await act(async () => {
      await result.current.save();
    });

    expect(mockUpdateDoc).not.toHaveBeenCalled();
  });

  // --- hasUnsavedEdits ---

  it('hasUnsavedEdits is true when content differs from draft', () => {
    const draft = makeDraft({ content: 'Original' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );

    act(() => {
      result.current.onChange('Edited');
    });

    expect(result.current.hasUnsavedEdits).toBe(true);
  });

  it('hasUnsavedEdits is false when content matches draft', () => {
    const draft = makeDraft({ content: 'Original' });
    const { result } = renderHook(() =>
      useDraftEditor(draft, 'e1', defaultUser, undefined, true),
    );

    expect(result.current.hasUnsavedEdits).toBe(false);
  });
});
