import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey, TransitionAnalysis } from '../types';
import type { TraitAnnotation } from '../components/AnnotatedEssay';
import AnnotatedEssay from '../components/AnnotatedEssay';
import TransitionView from '../components/TransitionView';
import DraftSelector from '../components/DraftSelector';
import GrammarView from '../components/GrammarView';
import type { GrammarAnalysis } from '../types';

export default function EssayPage() {
  const { essayId } = useParams<{ essayId: string }>();
  const { essay, drafts, loading } = useEssay(essayId);
  const [activeTrait, setActiveTrait] = useState<TraitKey | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [activeView, setActiveView] = useState<'feedback' | 'transitions' | 'grammar'>('feedback');
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [grammarError, setGrammarError] = useState<string | null>(null);

  // Collect all annotations with trait info
  const allAnnotations = useMemo(() => {
    const activeDraftId = selectedDraftId ?? drafts[0]?.id;
    const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? drafts[0];
    if (!activeDraft?.evaluation) return [];

    const result: TraitAnnotation[] = [];
    for (const traitKey of TRAIT_KEYS) {
      const trait = activeDraft.evaluation.traits[traitKey];
      if (!trait?.annotations) continue;
      for (const ann of trait.annotations) {
        result.push({ ...ann, traitKey, traitLabel: TRAIT_LABELS[traitKey] });
      }
    }
    return result;
  }, [drafts, selectedDraftId]);

  const handleTransitionsTab = useCallback(async () => {
    setActiveView('transitions');
    const activeDraftId_ = selectedDraftId ?? drafts[0]?.id;
    const activeDraft_ = drafts.find((d) => d.id === activeDraftId_) ?? drafts[0];
    if (!activeDraft_ || activeDraft_.transitionAnalysis) return;

    setTransitionLoading(true);
    setTransitionError(null);
    try {
      const analyzeTransitions = httpsCallable<
        { essayId: string; draftId: string },
        TransitionAnalysis
      >(functions, 'analyzeTransitions', { timeout: 180000 });
      await analyzeTransitions({ essayId: essayId!, draftId: activeDraft_.id });
      // Firestore listener will update the draft with transitionAnalysis
    } catch {
      setTransitionError('Failed to analyze transitions. Please try again.');
    } finally {
      setTransitionLoading(false);
    }
  }, [drafts, selectedDraftId, essayId]);

  const handleGrammarTab = useCallback(async () => {
    setActiveView('grammar');
    const activeDraftId_ = selectedDraftId ?? drafts[0]?.id;
    const activeDraft_ = drafts.find((d) => d.id === activeDraftId_) ?? drafts[0];
    if (!activeDraft_ || activeDraft_.grammarAnalysis) return;
    if (activeDraft_.grammarStatus && activeDraft_.grammarStatus.stage !== 'error') return;

    setGrammarLoading(true);
    setGrammarError(null);
    try {
      const analyzeGrammar = httpsCallable<
        { essayId: string; draftId: string },
        GrammarAnalysis
      >(functions, 'analyzeGrammar', { timeout: 180000 });
      await analyzeGrammar({ essayId: essayId!, draftId: activeDraft_.id });
    } catch {
      setGrammarError('Failed to analyze grammar. Please try again.');
    } finally {
      setGrammarLoading(false);
    }
  }, [drafts, selectedDraftId, essayId]);

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essay...</p></div>;
  if (!essay || drafts.length === 0) return <div>Essay not found.</div>;

  const activeDraftId = selectedDraftId ?? drafts[0].id;
  const activeDraft = drafts.find((d) => d.id === activeDraftId) ?? drafts[0];
  const isLatestDraft = activeDraft.id === drafts[0].id;

  const handleRetry = async () => {
    if (retryCount >= 3) return;
    setRetrying(true);
    try {
      const submitEssay = httpsCallable(functions, 'submitEssay', { timeout: 180000 });
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
    const status = activeDraft.evaluationStatus;
    // If we have a live status from the function, or draft is recent, show progress
    const age = Date.now() - activeDraft.submittedAt.getTime();
    const isRecent = age < 180000;
    if (status?.stage === 'error') {
      // Fall through to the error/retry UI below
    } else if (status || isRecent) {
      return (
        <div>
          <h2>{essay.title}</h2>
          <div className="loading-state" style={{ marginTop: 24 }}>
            <div className="spinner" />
            <p className="progress-message">{status?.message || 'Evaluating your essay...'}</p>
            {status?.stage === 'thinking' && (
              <p className="progress-stage">Gemini is thinking...</p>
            )}
            {status?.stage === 'generating' && (
              <p className="progress-stage">Writing your feedback...</p>
            )}
          </div>
        </div>
      );
    }
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
    <div className="essay-page">
      {/* Header */}
      <div className="essay-page-header">
        <div>
          <h2 className="essay-page-title">{essay.title}</h2>
          <DraftSelector drafts={drafts} selectedDraftId={activeDraftId} onChange={setSelectedDraftId} />
        </div>
        {isLatestDraft && (
          <Link to={`/essay/${essayId}/revise`} className="btn-primary">Start Revising</Link>
        )}
      </div>

      {/* Score strip */}
      <div className="score-strip">
        {TRAIT_KEYS.map((trait) => {
          const score = evaluation.traits[trait].score;
          const isActive = activeTrait === trait;
          const change = comparison?.scoreChanges[trait];
          return (
            <button
              key={trait}
              className={`score-badge ${scoreLevel(score)} ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTrait(isActive ? null : trait)}
              title={evaluation.traits[trait].feedback}
            >
              <span className="score-badge-label">{TRAIT_LABELS[trait]}</span>
              <span className="score-badge-value">{score}</span>
              {change && change.delta !== 0 && (
                <span className={`score-badge-delta ${change.delta > 0 ? 'up' : 'down'}`}>
                  {change.delta > 0 ? '+' : ''}{change.delta}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Active trait feedback panel */}
      {activeTrait && (
        <div className="trait-feedback-panel">
          <div className="trait-feedback-header">
            <strong>{TRAIT_LABELS[activeTrait]}</strong>
            <span className="trait-feedback-score" style={{ color: scoreColor(evaluation.traits[activeTrait].score) }}>
              {evaluation.traits[activeTrait].score}/6
            </span>
          </div>
          <p className="trait-feedback-text">{evaluation.traits[activeTrait].feedback}</p>
        </div>
      )}

      {/* View toggle: Feedback / Transitions */}
      <div className="view-toggle">
        <button
          className={`view-toggle-btn ${activeView === 'feedback' ? 'active' : ''}`}
          onClick={() => setActiveView('feedback')}
        >
          Feedback
        </button>
        <button
          className={`view-toggle-btn ${activeView === 'transitions' ? 'active' : ''}`}
          onClick={handleTransitionsTab}
        >
          Transitions
        </button>
        <button
          className={`view-toggle-btn ${activeView === 'grammar' ? 'active' : ''}`}
          onClick={handleGrammarTab}
        >
          Grammar
        </button>
      </div>

      {/* Essay with inline annotations — the main event */}
      {activeView === 'feedback' && (
        <AnnotatedEssay
          content={activeDraft.content}
          annotations={allAnnotations}
          readOnly
          activeTrait={activeTrait}
        />
      )}

      {/* Transition heatmap view */}
      {activeView === 'transitions' && (
        <>
          {activeDraft.transitionAnalysis ? (
            <TransitionView
              content={activeDraft.content}
              analysis={activeDraft.transitionAnalysis}
            />
          ) : transitionError ? (
            <div className="error-state">
              <p>{transitionError}</p>
              <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleTransitionsTab}>
                Retry
              </button>
            </div>
          ) : transitionLoading || activeDraft.transitionStatus ? (
            <div className="loading-state">
              <div className="spinner" />
              <p className="progress-message">
                {activeDraft.transitionStatus?.message || 'Analyzing transitions...'}
              </p>
              {activeDraft.transitionStatus?.stage === 'thinking' && (
                <p className="progress-stage">Gemini is thinking...</p>
              )}
              {activeDraft.transitionStatus?.stage === 'generating' && (
                <p className="progress-stage">Writing analysis...</p>
              )}
            </div>
          ) : (
            <div className="loading-state">
              <p>Click the Transitions tab to analyze this essay's transitions.</p>
            </div>
          )}
        </>
      )}

      {/* Grammar analysis view */}
      {activeView === 'grammar' && (
        <>
          {activeDraft.grammarAnalysis ? (
            <GrammarView
              content={activeDraft.content}
              analysis={activeDraft.grammarAnalysis}
            />
          ) : grammarError ? (
            <div className="error-state">
              <p>{grammarError}</p>
              <button className="btn-primary" style={{ marginTop: 8 }} onClick={handleGrammarTab}>
                Retry
              </button>
            </div>
          ) : grammarLoading || activeDraft.grammarStatus ? (
            <div className="loading-state">
              <div className="spinner" />
              <p className="progress-message">
                {activeDraft.grammarStatus?.message || 'Analyzing grammar...'}
              </p>
              {activeDraft.grammarStatus?.stage === 'thinking' && (
                <p className="progress-stage">Gemini is thinking...</p>
              )}
              {activeDraft.grammarStatus?.stage === 'generating' && (
                <p className="progress-stage">Writing analysis...</p>
              )}
            </div>
          ) : (
            <div className="loading-state">
              <p>Click the Grammar tab to analyze this essay's grammar.</p>
            </div>
          )}
        </>
      )}

      {/* Overall feedback + revision plan */}
      <div className="essay-footer">
        {evaluation.overallFeedback && (
          <div className="overall-feedback">
            <h3>Overall</h3>
            <p>{evaluation.overallFeedback}</p>
          </div>
        )}

        {evaluation.revisionPlan.length > 0 && (
          <div className="revision-plan">
            <h3>Revision Plan</h3>
            <ol>
              {evaluation.revisionPlan.map((step, i) => <li key={i}>{step}</li>)}
            </ol>
          </div>
        )}

        {comparison && comparison.improvements.length > 0 && (
          <div className="comparison-section">
            <h3>Improvements</h3>
            <ul>
              {comparison.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
            </ul>
          </div>
        )}
        {comparison && comparison.remainingIssues.length > 0 && (
          <div className="comparison-section remaining">
            <h3>Still to Work On</h3>
            <ul>
              {comparison.remainingIssues.map((issue, i) => <li key={i}>{issue}</li>)}
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function scoreLevel(score: number): string {
  if (score <= 2) return 'low';
  if (score === 3) return 'mid';
  return 'high';
}

function scoreColor(score: number): string {
  if (score <= 2) return 'var(--color-red)';
  if (score === 3) return 'var(--color-yellow)';
  return 'var(--color-green)';
}
