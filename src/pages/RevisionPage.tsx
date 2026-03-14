import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey } from '../types';
import AnnotatedEssay from '../components/AnnotatedEssay';

export default function RevisionPage() {
  const { essayId } = useParams<{ essayId: string }>();
  const navigate = useNavigate();
  const { essay, drafts, loading } = useEssay(essayId);
  const [selectedTrait, setSelectedTrait] = useState<TraitKey>('conventions');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

  const latestDraft = drafts[0];

  useEffect(() => {
    if (!latestDraft) return;
    const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
    setContent(saved ?? latestDraft.content);
    // Set selected trait to first revision priority
    if (latestDraft.evaluation) {
      const prioritized = TRAIT_KEYS
        .filter((t) => latestDraft.evaluation!.traits[t].revisionPriority !== null)
        .sort((a, b) => (latestDraft.evaluation!.traits[a].revisionPriority! - latestDraft.evaluation!.traits[b].revisionPriority!));
      if (prioritized.length > 0) setSelectedTrait(prioritized[0]);
    }
  }, [latestDraft, essayId]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    localStorage.setItem(`essaycoach_autosave_${essayId}`, newContent);
  }, [essayId]);

  const handleResubmit = async () => {
    if (retryCount >= 3 || !essayId) return;
    setSubmitting(true);
    setError(null);
    try {
      const resubmitDraft = httpsCallable(functions, 'resubmitDraft');
      await resubmitDraft({ essayId, content });
      localStorage.removeItem(`essaycoach_autosave_${essayId}`);
      navigate(`/essay/${essayId}`);
    } catch (err: any) {
      setError(err.message || 'Failed to resubmit. Please try again.');
      setRetryCount((c) => c + 1);
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading...</p></div>;
  if (!essay || !latestDraft?.evaluation) return <div>Essay not found or not yet evaluated.</div>;

  const evaluation = latestDraft.evaluation;
  const traitEval = evaluation.traits[selectedTrait];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{essay.title} — Revision</h2>
        <button onClick={handleResubmit} className="btn-primary" disabled={submitting || retryCount >= 3}>
          {submitting ? 'Resubmitting...' : 'Resubmit'}
        </button>
      </div>

      <div className="trait-selector">
        {TRAIT_KEYS.map((trait) => (
          <button key={trait} className={selectedTrait === trait ? 'active' : ''}
            onClick={() => setSelectedTrait(trait)}>
            {TRAIT_LABELS[trait]}
            {evaluation.traits[trait].revisionPriority && ` (${evaluation.traits[trait].revisionPriority})`}
          </button>
        ))}
      </div>

      {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}

      <div className="side-by-side">
        <div>
          <AnnotatedEssay
            content={content}
            annotations={traitEval.annotations}
            onChange={handleContentChange}
          />
        </div>
        <div>
          <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 16 }}>
            <h3 style={{ fontSize: 15, marginBottom: 4 }}>{TRAIT_LABELS[selectedTrait]}</h3>
            <div style={{ fontSize: 18, fontWeight: 700, marginBottom: 12, color: traitEval.score <= 2 ? 'var(--color-red)' : traitEval.score === 3 ? 'var(--color-yellow)' : 'var(--color-green)' }}>
              {traitEval.score}/6
            </div>
            <p style={{ fontSize: 14, lineHeight: 1.6, marginBottom: 16 }}>{traitEval.feedback}</p>
            {traitEval.annotations.map((ann, i) => (
              <div key={i} className="annotation">
                <div className="annotation-quote">"{ann.quotedText}"</div>
                <div className="annotation-comment">{ann.comment}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
