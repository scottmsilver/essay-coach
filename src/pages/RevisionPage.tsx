import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { functions, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import DocBar from '../components/DocBar';
import { useEssay } from '../hooks/useEssay';
import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey } from '../types';
import { handleRichPaste } from '../utils/pasteHandler';
import { scoreLevel, scoreColor, collectAnnotations, classifyAnnotation } from '../utils';

export default function RevisionPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);
  const [selectedTrait, setSelectedTrait] = useState<TraitKey | null>(null);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const initialized = useRef(false);

  const latestDraft = drafts[0];

  // Initialize content ONCE from localStorage or draft — not on every snapshot
  useEffect(() => {
    if (!latestDraft || initialized.current) return;
    initialized.current = true;
    const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
    setContent(saved ?? latestDraft.content);
    if (latestDraft.evaluation) {
      const prioritized = TRAIT_KEYS
        .filter((t) => latestDraft.evaluation!.traits[t].revisionPriority !== null)
        .sort((a, b) => (latestDraft.evaluation!.traits[a].revisionPriority! - latestDraft.evaluation!.traits[b].revisionPriority!));
      if (prioritized.length > 0) setSelectedTrait(prioritized[0]);
    }
  }, [latestDraft, essayId]);

  const allAnnotations = useMemo(() => {
    if (!latestDraft?.evaluation) return [];
    return collectAnnotations(latestDraft.evaluation);
  }, [latestDraft]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    localStorage.setItem(`essaycoach_autosave_${essayId}`, newContent);
  }, [essayId]);

  const handleResubmit = async () => {
    if (retryCount >= 3 || !essayId || !user || !latestDraft) return;
    setSubmitting(true);
    setError(null);
    try {
      const uid = ownerUid ?? user.uid;
      const newDraftNumber = (essay?.currentDraftNumber ?? latestDraft.draftNumber) + 1;
      const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
      const draftRef = doc(collection(db, `users/${uid}/essays/${essayId}/drafts`));

      await Promise.all([
        setDoc(draftRef, {
          draftNumber: newDraftNumber,
          content,
          submittedAt: serverTimestamp(),
        }),
        updateDoc(essayRef, {
          currentDraftNumber: newDraftNumber,
          updatedAt: serverTimestamp(),
        }),
      ]);

      localStorage.removeItem(`essaycoach_autosave_${essayId}`);
      navigate(ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`);

      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
      evaluateEssay({ essayId, draftId: draftRef.id }).catch((err) => {
        console.error('Background evaluation failed:', err);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit. Please try again.');
      setRetryCount((c) => c + 1);
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading...</p></div>;
  if (!essay || !latestDraft?.evaluation) return <div>Essay not found or not yet evaluated.</div>;

  const evaluation = latestDraft.evaluation;

  return (
    <div className="essay-page">
      <DocBar title={`${essay.title} — Revision`} />

      {error && <div className="error-state" style={{ marginBottom: 0, padding: '4px 12px', fontSize: 12 }}>{error}</div>}

      {/* Row 2 — Score pills + Resubmit */}
      <div className="analysis-bar">
        <div className="analysis-bar-scores">
          {TRAIT_KEYS.map((trait) => {
            const score = evaluation.traits[trait].score;
            const isActive = selectedTrait === trait;
            const priority = evaluation.traits[trait].revisionPriority;
            return (
              <button
                key={trait}
                className={`score-pill ${scoreLevel(score)} ${isActive ? 'active' : ''}`}
                onClick={() => setSelectedTrait(isActive ? null : trait)}
                title={evaluation.traits[trait].feedback}
              >
                <span className="score-pill-label">{TRAIT_LABELS[trait]}</span>
                <span className="score-pill-value">{score}</span>
                {priority !== null && <span className="score-pill-priority">#{priority}</span>}
              </button>
            );
          })}
        </div>
        <div className="analysis-bar-right">
          <button onClick={handleResubmit} className="btn-accent btn-compact" disabled={submitting || retryCount >= 3}>
            {submitting ? 'Evaluating...' : 'Resubmit'}
          </button>
        </div>
      </div>

      {/* Trait feedback panel */}
      {selectedTrait && (
        <div className="trait-feedback-panel">
          <div className="trait-feedback-header">
            <strong>{TRAIT_LABELS[selectedTrait]}</strong>
            <span className="trait-feedback-score" style={{ color: scoreColor(evaluation.traits[selectedTrait].score) }}>
              {evaluation.traits[selectedTrait].score}/6
            </span>
          </div>
          <p className="trait-feedback-text">{evaluation.traits[selectedTrait].feedback}</p>
        </div>
      )}

      {/* Revision plan */}
      {evaluation.revisionPlan.length > 0 && (
        <div className="revision-plan-inline">
          <strong>Focus on:</strong>
          <ol>
            {evaluation.revisionPlan.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}

      {/* Essay editor with annotation sidebar for reference */}
      <div className="revision-layout">
        <div className="revision-editor">
          <textarea
            className="essay-editor"
            value={content}
            onChange={(e) => handleContentChange(e.target.value)}
            onPaste={(e) => handleRichPaste(e, handleContentChange)}
          />
        </div>
        <div className="revision-annotations">
          <div className="revision-annotations-header">Feedback</div>
          {(selectedTrait
            ? allAnnotations.filter(a => a.traitKey === selectedTrait)
            : allAnnotations
          ).map((ann, i) => (
            <div key={i} className={`sidebar-comment ${classifyAnnotation(ann.comment)}`} style={{ position: 'static' }}>
              <span className="sidebar-comment-trait">{ann.traitLabel}</span>
              <span className="sidebar-comment-text">{ann.comment}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
