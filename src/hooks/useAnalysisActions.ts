import { useState, useCallback } from 'react';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc } from 'firebase/firestore';
import { functions, db } from '../firebase';
import { FUNCTION_TIMEOUT } from '../utils/submitEssay';
import type { DraftEntity } from '../entities/draftEntity';

export type ActionKey = 'grammar' | 'transitions' | 'prompt';

export interface AnalysisActions {
  loading: Record<ActionKey, boolean>;
  errors: Record<ActionKey, string | null>;
  ensure: (key: ActionKey) => Promise<void>;
  rerun: (key: ActionKey) => Promise<void>;
  rerunOverall: () => Promise<void>;
  retrying: boolean;
  retryCount: number;
}

const ANALYSIS_CONFIG: Record<ActionKey, { fn: string; dataField: string; statusField: string }> = {
  grammar: { fn: 'analyzeGrammar', dataField: 'grammarAnalysis', statusField: 'grammarStatus' },
  transitions: { fn: 'analyzeTransitions', dataField: 'transitionAnalysis', statusField: 'transitionStatus' },
  prompt: { fn: 'analyzePromptAdherence', dataField: 'promptAnalysis', statusField: 'promptStatus' },
};

const INITIAL_LOADING: Record<ActionKey, boolean> = { grammar: false, transitions: false, prompt: false };
const INITIAL_ERRORS: Record<ActionKey, string | null> = { grammar: null, transitions: null, prompt: null };

export function useAnalysisActions(
  entity: DraftEntity | null,
  essayId: string | undefined,
  ownerUid: string | undefined,
  user: { uid: string } | null,
): AnalysisActions {
  const [loading, setLoading] = useState<Record<ActionKey, boolean>>({ ...INITIAL_LOADING });
  const [errors, setErrors] = useState<Record<ActionKey, string | null>>({ ...INITIAL_ERRORS });
  const [retrying, setRetrying] = useState(false);
  const [retryCount, setRetryCount] = useState(0);

  const run = useCallback(async (key: ActionKey) => {
    if (!entity || !essayId) return;
    const config = ANALYSIS_CONFIG[key];
    setLoading((prev) => ({ ...prev, [key]: true }));
    setErrors((prev) => ({ ...prev, [key]: null }));
    try {
      const callable = httpsCallable(functions, config.fn, { timeout: FUNCTION_TIMEOUT });
      await callable({ essayId, draftId: entity.raw.id, ownerUid });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Analysis failed. Please try again.';
      setErrors((prev) => ({ ...prev, [key]: message }));
    } finally {
      setLoading((prev) => ({ ...prev, [key]: false }));
    }
  }, [entity, essayId, ownerUid]);

  const ensure = useCallback(async (key: ActionKey) => {
    if (!entity) return;
    const status = entity.analysisStatus(key);
    if (status === 'ready') return;
    if (status === 'loading') return;
    if (loading[key]) return;
    await run(key);
  }, [entity, loading, run]);

  const rerun = useCallback(async (key: ActionKey) => {
    if (!entity || !user || !essayId) return;
    const config = ANALYSIS_CONFIG[key];
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${entity.raw.id}`);
    await updateDoc(draftRef, { [config.dataField]: null, [config.statusField]: null });
    await run(key);
  }, [entity, user, essayId, ownerUid, run]);

  const rerunOverall = useCallback(async () => {
    if (!entity || !user || !essayId) return;
    setRetrying(true);
    try {
      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: FUNCTION_TIMEOUT });
      await evaluateEssay({ essayId, draftId: entity.raw.id, ownerUid, force: true });
    } catch {
      setRetryCount((c) => c + 1);
    } finally {
      setRetrying(false);
    }
  }, [entity, user, essayId, ownerUid]);

  return { loading, errors, ensure, rerun, rerunOverall, retrying, retryCount };
}
