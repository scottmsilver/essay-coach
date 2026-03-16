import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc } from 'firebase/firestore';
import { functions, db } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { scoreLevel, scoreColor, relativeTime, collectAnnotations } from '../utils';
import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey, TransitionAnalysis, GrammarAnalysis } from '../types';
import DocBar from '../components/DocBar';
import AnalysisPanel from '../components/AnalysisPanel';
import AnnotatedEssay from '../components/AnnotatedEssay';
import TransitionView from '../components/TransitionView';
import GrammarView from '../components/GrammarView';

export default function EssayPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);
  const [activeTrait, setActiveTrait] = useState<TraitKey | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const [activeView, setActiveView] = useState<'feedback' | 'transitions' | 'grammar'>('feedback');
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const popoverRef = useClickOutside<HTMLDivElement>((e) => {
    const badge = (e.target as Element)?.closest?.('.score-pill');
    if (!badge) setActiveTrait(null);
  }, !!activeTrait);

  // Single source of truth for active draft
  const activeDraft = useMemo(() => {
    if (drafts.length === 0) return undefined;
    const id = selectedDraftId ?? drafts[0].id;
    return drafts.find((d) => d.id === id) ?? drafts[0];
  }, [drafts, selectedDraftId]);

  const allAnnotations = useMemo(() => {
    if (!activeDraft?.evaluation) return [];
    return collectAnnotations(activeDraft.evaluation);
  }, [activeDraft]);

  // Shared grammar analysis caller
  const runGrammarAnalysis = useCallback(async (draftId: string) => {
    setGrammarLoading(true);
    setGrammarError(null);
    try {
      const analyzeGrammar = httpsCallable<
        { essayId: string; draftId: string; ownerUid?: string },
        GrammarAnalysis
      >(functions, 'analyzeGrammar', { timeout: 180000 });
      await analyzeGrammar({ essayId: essayId!, draftId, ownerUid });
    } catch {
      setGrammarError('Failed to analyze grammar. Please try again.');
    } finally {
      setGrammarLoading(false);
    }
  }, [essayId, ownerUid]);

  const handleTransitionsTab = useCallback(async () => {
    setActiveView('transitions');
    if (!activeDraft || activeDraft.transitionAnalysis) return;

    setTransitionLoading(true);
    setTransitionError(null);
    try {
      const analyzeTransitions = httpsCallable<
        { essayId: string; draftId: string; ownerUid?: string },
        TransitionAnalysis
      >(functions, 'analyzeTransitions', { timeout: 180000 });
      await analyzeTransitions({ essayId: essayId!, draftId: activeDraft.id, ownerUid });
    } catch {
      setTransitionError('Failed to analyze transitions. Please try again.');
    } finally {
      setTransitionLoading(false);
    }
  }, [activeDraft, essayId, ownerUid]);

  const handleGrammarTab = useCallback(async () => {
    setActiveView('grammar');
    if (!activeDraft || activeDraft.grammarAnalysis) return;
    if (activeDraft.grammarStatus && activeDraft.grammarStatus.stage !== 'error') return;
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, runGrammarAnalysis]);

  const handleGrammarReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { grammarAnalysis: null, grammarStatus: null });
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runGrammarAnalysis]);

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essay...</p></div>;
  if (!essay || !activeDraft) return <div>Essay not found.</div>;

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
          {!ownerUid && retryCount < 3 ? (
            <button onClick={handleRetry} className="btn-primary" style={{ marginTop: 12 }} disabled={retrying}>
              {retrying ? 'Retrying...' : 'Retry'}
            </button>
          ) : ownerUid ? (
            <p style={{ marginTop: 8 }}>Only the essay owner can retry evaluation.</p>
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
      <DocBar title={essay.title}>
        {drafts.length > 1 && (
          <select
            className="doc-bar-draft"
            value={activeDraft.id}
            onChange={(e) => setSelectedDraftId(e.target.value)}
          >
            {drafts.map((d) => (
              <option key={d.id} value={d.id}>
                Rev {d.draftNumber} — {relativeTime(d.submittedAt)}
              </option>
            ))}
          </select>
        )}
      </DocBar>

      {/* Row 2 — Analysis bar */}
      <div className="analysis-bar">
        <div className="analysis-bar-left">
          <select
            className="view-dropdown"
            value={activeView}
            onChange={(e) => {
              const view = e.target.value as 'feedback' | 'transitions' | 'grammar';
              if (view === 'transitions') handleTransitionsTab();
              else if (view === 'grammar') handleGrammarTab();
              else setActiveView('feedback');
            }}
          >
            <option value="feedback">Overall</option>
            <option value="transitions">Transitions</option>
            <option value="grammar">Grammar</option>
          </select>
        </div>
        {activeView === 'feedback' && (
          <div className="analysis-bar-scores">
            {TRAIT_KEYS.map((trait) => {
              const score = evaluation.traits[trait].score;
              const isActive = activeTrait === trait;
              const change = comparison?.scoreChanges[trait];
              return (
                <div key={trait} style={{ position: 'relative' }}>
                  <button
                    className={`score-pill ${scoreLevel(score)} ${isActive ? 'active' : ''}`}
                    onClick={() => setActiveTrait(isActive ? null : trait)}
                  >
                    <span className="score-pill-label">{TRAIT_LABELS[trait]}</span>
                    <span className="score-pill-value">{score}</span>
                    {change && change.delta !== 0 && (
                      <span className={`score-pill-delta ${change.delta > 0 ? 'up' : 'down'}`}>
                        {change.delta > 0 ? '+' : ''}{change.delta}
                      </span>
                    )}
                  </button>
                  {isActive && (
                    <div className="trait-popover" ref={popoverRef}>
                      <div className="trait-popover-header">
                        <strong>{TRAIT_LABELS[trait]}</strong>
                        <span style={{ color: scoreColor(score), fontWeight: 700 }}>{score}/6</span>
                      </div>
                      <p className="trait-popover-text">{evaluation.traits[trait].feedback}</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
        <div className="analysis-bar-right">
          {activeView === 'grammar' && activeDraft.grammarAnalysis && (
            <button onClick={handleGrammarReanalyze} className="btn-accent btn-compact" style={{ opacity: 0.7 }}>
              Re-analyze
            </button>
          )}
          {isLatestDraft && (
            <Link
              to={ownerUid ? `/user/${ownerUid}/essay/${essayId}/revise` : `/essay/${essayId}/revise`}
              className="btn-accent btn-compact"
            >
              Revise
            </Link>
          )}
        </div>
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

      {activeView === 'transitions' && (
        <AnalysisPanel
          data={activeDraft.transitionAnalysis}
          error={transitionError}
          loading={transitionLoading}
          status={activeDraft.transitionStatus}
          onRetry={handleTransitionsTab}
          defaultMessage="Analyzing transitions..."
          placeholder="Click the Transitions tab to analyze this essay's transitions."
        >
          <TransitionView content={activeDraft.content} analysis={activeDraft.transitionAnalysis!} />
        </AnalysisPanel>
      )}

      {activeView === 'grammar' && (
        <AnalysisPanel
          data={activeDraft.grammarAnalysis}
          error={grammarError}
          loading={grammarLoading}
          status={activeDraft.grammarStatus}
          onRetry={handleGrammarTab}
          defaultMessage="Analyzing grammar..."
          placeholder="Click the Grammar tab to analyze this essay's grammar."
        >
          <GrammarView content={activeDraft.content} analysis={activeDraft.grammarAnalysis!} />
        </AnalysisPanel>
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
