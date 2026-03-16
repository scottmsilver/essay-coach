import { useState, useMemo, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc } from 'firebase/firestore';
import { Button, Select, Group } from '@mantine/core';
import { functions, db } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { scoreColor, relativeTime, collectAnnotations } from '../utils';
import { TRAIT_LABELS } from '../types';
import type { TraitKey, TransitionAnalysis, GrammarAnalysis } from '../types';
import DocBar from '../components/DocBar';
import ScorePillBar from '../components/ScorePillBar';
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
      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
      await evaluateEssay({ essayId: essayId!, draftId: activeDraft.id });
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
            <Button onClick={handleRetry} size="sm" mt={12} disabled={retrying} loading={retrying}>
              Retry
            </Button>
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
          <Select
            size="xs"
            value={activeDraft.id}
            onChange={(val) => val && setSelectedDraftId(val)}
            data={drafts.map((d) => ({ value: d.id, label: `Rev ${d.draftNumber} — ${relativeTime(d.submittedAt)}` }))}
            styles={{ input: { minWidth: 180 } }}
          />
        )}
      </DocBar>

      {/* Row 2 — Analysis bar */}
      <div className="analysis-bar">
        <div className="analysis-bar-left">
          <Select
            size="xs"
            value={activeView}
            onChange={(val) => {
              const view = val as 'feedback' | 'transitions' | 'grammar';
              if (view === 'transitions') handleTransitionsTab();
              else if (view === 'grammar') handleGrammarTab();
              else setActiveView('feedback');
            }}
            data={[
              { value: 'feedback', label: 'Overall' },
              { value: 'transitions', label: 'Transitions' },
              { value: 'grammar', label: 'Grammar' },
            ]}
            styles={{ input: { minWidth: 130 } }}
          />
        </div>
        {activeView === 'feedback' && (
          <div style={{ position: 'relative', display: 'contents' }}>
            <ScorePillBar
              evaluation={evaluation}
              activeKey={activeTrait}
              onSelect={setActiveTrait}
              scoreChanges={comparison?.scoreChanges}
            />
            {activeTrait && (
              <div className="trait-popover" ref={popoverRef}>
                <div className="trait-popover-header">
                  <strong>{TRAIT_LABELS[activeTrait]}</strong>
                  <span style={{ color: scoreColor(evaluation.traits[activeTrait].score), fontWeight: 700 }}>
                    {evaluation.traits[activeTrait].score}/6
                  </span>
                </div>
                <p className="trait-popover-text">{evaluation.traits[activeTrait].feedback}</p>
              </div>
            )}
          </div>
        )}
        <Group className="analysis-bar-right" gap="xs">
          <Button
            size="compact-sm"
            variant="default"
            onClick={
              activeView === 'grammar' ? handleGrammarReanalyze
              : activeView === 'transitions' ? handleTransitionsTab
              : handleRetry
            }
            disabled={
              activeView === 'grammar' ? grammarLoading
              : activeView === 'transitions' ? transitionLoading
              : retrying || retryCount >= 3
            }
            loading={activeView === 'grammar' ? grammarLoading : activeView === 'transitions' ? transitionLoading : retrying}
          >
            Rerun
          </Button>
          {isLatestDraft && (
            <Button
              size="compact-sm"
              component={Link}
              to={ownerUid ? `/user/${ownerUid}/essay/${essayId}/revise` : `/essay/${essayId}/revise`}
            >
              Revise
            </Button>
          )}
        </Group>
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
