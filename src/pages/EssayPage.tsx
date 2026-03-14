import { useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { TRAIT_KEYS } from '../types';
import type { TraitKey } from '../types';
import TraitCard from '../components/TraitCard';
import RevisionPlanBanner from '../components/RevisionPlanBanner';
import DraftSelector from '../components/DraftSelector';
import ScoreDelta from '../components/ScoreDelta';

export default function EssayPage() {
  const { essayId } = useParams<{ essayId: string }>();
  const { essay, drafts, loading } = useEssay(essayId);
  const [expandedTrait, setExpandedTrait] = useState<TraitKey | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essay...</p></div>;
  if (!essay || drafts.length === 0) return <div>Essay not found.</div>;

  const activeDraftId = selectedDraftId ?? drafts[0].id;
  const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? drafts[0];
  const isLatestDraft = activeDraft.id === drafts[0].id;

  const handleRetry = async () => {
    if (retryCount >= 3) return;
    setRetrying(true);
    try {
      const submitEssay = httpsCallable(functions, 'submitEssay');
      await submitEssay({
        title: essay.title,
        assignmentPrompt: essay.assignmentPrompt,
        writingType: essay.writingType,
        content: activeDraft.content,
      });
    } catch {
      setRetryCount((c) => c + 1);
    } finally {
      setRetrying(false);
    }
  };

  if (!activeDraft.evaluation) {
    return (
      <div>
        <h2>{essay.title}</h2>
        <div className="error-state" style={{ marginTop: 24 }}>
          <p>Evaluation failed. Your essay has been saved.</p>
          {retryCount < 3 ? (
            <button onClick={handleRetry} className="btn-primary" style={{ marginTop: 12 }} disabled={retrying}>
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          ) : (
            <p style={{ marginTop: 8 }}>Maximum retries reached. Please try again later.</p>
          )}
        </div>
      </div>
    );
  }

  const evaluation = activeDraft.evaluation;
  const comparison = evaluation.comparisonToPrevious;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h2>{essay.title}</h2>
        {isLatestDraft && (
          <Link to={`/essay/${essayId}/revise`} className="btn-primary">Start Revising</Link>
        )}
      </div>

      <DraftSelector drafts={drafts} selectedDraftId={activeDraftId} onChange={setSelectedDraftId} />

      <RevisionPlanBanner revisionPlan={evaluation.revisionPlan} />

      {comparison && (
        <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 16, marginBottom: 24 }}>
          <h3 style={{ fontSize: 15, marginBottom: 12 }}>Draft Comparison</h3>
          {Object.entries(comparison.scoreChanges).map(([trait, change]) => (
            <div key={trait} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 14 }}>{trait}:</span>
              <ScoreDelta previous={change!.previous} current={change!.current} />
            </div>
          ))}
          {comparison.improvements.length > 0 && (
            <div style={{ marginTop: 12 }}>
              <strong style={{ fontSize: 13 }}>Improvements:</strong>
              <ul style={{ fontSize: 13, color: 'var(--color-green)', paddingLeft: 20 }}>
                {comparison.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
              </ul>
            </div>
          )}
          {comparison.remainingIssues.length > 0 && (
            <div style={{ marginTop: 8 }}>
              <strong style={{ fontSize: 13 }}>Remaining Issues:</strong>
              <ul style={{ fontSize: 13, color: 'var(--color-yellow)', paddingLeft: 20 }}>
                {comparison.remainingIssues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      <div className="trait-grid">
        {TRAIT_KEYS.map((trait) => (
          <TraitCard
            key={trait}
            traitKey={trait}
            evaluation={evaluation.traits[trait]}
            expanded={expandedTrait === trait}
            onClick={() => setExpandedTrait(expandedTrait === trait ? null : trait)}
          />
        ))}
      </div>

      <div style={{ marginTop: 24, padding: 16, background: 'var(--color-surface)', borderRadius: 10, border: '1px solid var(--color-border)' }}>
        <h3 style={{ fontSize: 15, marginBottom: 8 }}>Overall Feedback</h3>
        <p style={{ fontSize: 14, lineHeight: 1.6, color: 'var(--color-text-secondary)' }}>{evaluation.overallFeedback}</p>
      </div>
    </div>
  );
}
