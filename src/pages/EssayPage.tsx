import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate, Link } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc } from 'firebase/firestore';
import { Button, Select, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
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
import { shouldAskPermission, requestPermission, notifyEvaluationComplete } from '../utils/notifications';

type ViewMode = 'feedback' | 'transitions' | 'grammar';

function viewFromPath(pathname: string): ViewMode {
  if (pathname.endsWith('/transitions')) return 'transitions';
  if (pathname.endsWith('/grammar')) return 'grammar';
  return 'feedback';
}

export default function EssayPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);
  const [activeTrait, setActiveTrait] = useState<TraitKey | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const activeView = viewFromPath(location.pathname);
  const basePath = ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`;
  const setActiveView = useCallback((view: ViewMode) => {
    const suffix = view === 'feedback' ? '' : `/${view}`;
    navigate(`${basePath}${suffix}`, { replace: true });
  }, [navigate, basePath]);
  const [transitionLoading, setTransitionLoading] = useState(false);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [grammarLoading, setGrammarLoading] = useState(false);
  const [grammarError, setGrammarError] = useState<string | null>(null);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(
    () => sessionStorage.getItem('essaycoach_notif_dismissed') === '1'
  );
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

  // Toast + browser notification when evaluation completes
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (!loading && activeDraft && !activeDraft.evaluation) {
      wasWaiting.current = true;
    }
    if (wasWaiting.current && activeDraft?.evaluation) {
      wasWaiting.current = false;
      notifications.show({
        title: 'Evaluation Complete',
        message: 'Your essay feedback is ready!',
        color: 'green',
        autoClose: 5000,
      });
      // Browser notification if tab is backgrounded
      if (essay) {
        const traits = activeDraft.evaluation.traits;
        const scores = Object.values(traits).map((t: { score: number }) => t.score);
        const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
        notifyEvaluationComplete(essay.title, avg);
      }
    }
  }, [loading, activeDraft, essay]);

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
    // Don't fire if already in progress (pending/thinking/generating from parallel submit)
    if (activeDraft.transitionStatus && activeDraft.transitionStatus.stage !== 'error') return;

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
  }, [activeDraft, essayId, ownerUid, setActiveView]);

  const handleGrammarTab = useCallback(async () => {
    setActiveView('grammar');
    if (!activeDraft || activeDraft.grammarAnalysis) return;
    if (activeDraft.grammarStatus && activeDraft.grammarStatus.stage !== 'error') return;
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, runGrammarAnalysis, setActiveView]);

  const handleGrammarReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { grammarAnalysis: null, grammarStatus: null });
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runGrammarAnalysis]);

  const handleTransitionReanalyze = useCallback(async () => {
    if (!activeDraft) return;
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

  const handleFeedbackReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    setRetrying(true);
    try {
      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
      await evaluateEssay({ essayId: essayId!, draftId: activeDraft.id, ownerUid, force: true });
    } catch {
      setRetryCount((c) => c + 1);
    } finally {
      setRetrying(false);
    }
  }, [activeDraft, essayId, ownerUid, user]);

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

  const evaluation = activeDraft?.evaluation ?? null;
  const comparison = evaluation?.comparisonToPrevious ?? null;
  const isPending = !evaluation;
  const evalStatus = activeDraft?.evaluationStatus;
  const isEvalError = isPending && evalStatus?.stage === 'error';
  const age = activeDraft ? Date.now() - activeDraft.submittedAt.getTime() : 0;
  const isStale = isPending && !evalStatus && age >= 180000;

  // Show notification permission banner when evaluation is pending
  const showNotifBanner = isPending && !isEvalError && !isStale && !notifBannerDismissed && shouldAskPermission();
  const dismissNotifBanner = () => {
    setNotifBannerDismissed(true);
    sessionStorage.setItem('essaycoach_notif_dismissed', '1');
  };

  return (
    <div className="essay-page">
      <DocBar
        title={essay.title}
        activeDraftId={activeDraft.id}
        draftLabel={`v${activeDraft.draftNumber} — ${relativeTime(activeDraft.submittedAt)}`}
        draftOptions={drafts.map((d) => ({ id: d.id, label: `v${d.draftNumber} — ${relativeTime(d.submittedAt)}` }))}
        onPickDraft={setSelectedDraftId}
      >
        <Group gap="xs">
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
            styles={{ input: { minWidth: 110 } }}
          />
          {evaluation && (
            <Button
              size="compact-xs"
              variant="default"
              onClick={
                activeView === 'grammar' ? handleGrammarReanalyze
                : activeView === 'transitions' ? handleTransitionReanalyze
                : handleFeedbackReanalyze
              }
              disabled={
                activeView === 'grammar' ? grammarLoading
                : activeView === 'transitions' ? transitionLoading
                : retrying || retryCount >= 3
              }
              loading={activeView === 'grammar' ? grammarLoading : activeView === 'transitions' ? transitionLoading : retrying}
            >
              Analyze
            </Button>
          )}
          {isLatestDraft && evaluation && (
            <Button
              size="compact-xs"
              component={Link}
              to={ownerUid ? `/user/${ownerUid}/essay/${essayId}/revise` : `/essay/${essayId}/revise`}
            >
              Revise
            </Button>
          )}
        </Group>
      </DocBar>

      {/* Notification permission banner */}
      {showNotifBanner && (
        <div className="notification-banner">
          <span className="notification-banner-text">
            Want us to notify you when feedback is ready?
          </span>
          <Button size="compact-xs" onClick={async () => {
            await requestPermission();
            dismissNotifBanner();
          }}>
            Enable Notifications
          </Button>
          <Button size="compact-xs" variant="subtle" onClick={dismissNotifBanner}>
            Dismiss
          </Button>
        </div>
      )}

      {/* Score bar — sticky below breadcrumb */}
      {activeView === 'feedback' && (
        <div className="score-bar">
          <div style={{ position: 'relative', flex: 1, display: 'flex', justifyContent: 'center' }}>
            {evaluation ? (
              <>
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
              </>
            ) : (
              <ScorePillBar skeleton />
            )}
          </div>
          {/* Evaluation status indicator */}
          {isPending && !isEvalError && !isStale && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 12, flexShrink: 0 }}>
              <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} />
              <span style={{ fontSize: 12, color: 'var(--color-text-muted)', whiteSpace: 'nowrap' }}>
                {evalStatus?.message || 'Evaluating...'}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Error state for evaluation */}
      {isPending && (isEvalError || isStale) && activeView === 'feedback' && (
        <div className="error-state" style={{ margin: '16px 24px' }}>
          <p>Evaluation failed. Your essay has been saved.</p>
          {!ownerUid && retryCount < 3 ? (
            <Button onClick={handleRetry} size="sm" mt={8} disabled={retrying} loading={retrying}>
              Retry
            </Button>
          ) : ownerUid ? (
            <p style={{ marginTop: 8 }}>Only the essay owner can retry evaluation.</p>
          ) : (
            <p style={{ marginTop: 8 }}>Maximum retries reached. Please try again later.</p>
          )}
        </div>
      )}

      {/* Feedback summary — only on overall/feedback tab, only when evaluation exists */}
      {activeView === 'feedback' && evaluation && (
        <div className="feedback-summary">
          {evaluation.overallFeedback && (
            <p className="feedback-summary-text">{evaluation.overallFeedback}</p>
          )}
          {evaluation.revisionPlan.length > 0 && (
            <div className="feedback-summary-section">
              <strong>Revision Plan</strong>
              <ol>
                {evaluation.revisionPlan.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          )}
          {comparison && comparison.improvements.length > 0 && (
            <div className="feedback-summary-section improvements">
              <strong>Improvements</strong>
              <ul>
                {comparison.improvements.map((imp, i) => <li key={i}>{imp}</li>)}
              </ul>
            </div>
          )}
          {comparison && comparison.remainingIssues.length > 0 && (
            <div className="feedback-summary-section remaining">
              <strong>Still to Work On</strong>
              <ul>
                {comparison.remainingIssues.map((issue, i) => <li key={i}>{issue}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Essay with inline annotations or plain text when pending */}
      {activeView === 'feedback' && (
        evaluation ? (
          <AnnotatedEssay
            content={activeDraft.content}
            annotations={allAnnotations}
            readOnly
            activeTrait={activeTrait}
          />
        ) : (
          <div className="skeleton-essay">
            <div className="skeleton-essay-text">{activeDraft.content}</div>
          </div>
        )
      )}

      {activeView === 'transitions' && (
        <AnalysisPanel
          data={activeDraft.transitionAnalysis}
          error={transitionError}
          loading={transitionLoading}
          status={activeDraft.transitionStatus}
          onRetry={handleTransitionsTab}
          defaultMessage="Analyzing transitions..."
          placeholder="Transitions analysis is loading..."
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
          placeholder="Grammar analysis is loading..."
        >
          <GrammarView content={activeDraft.content} analysis={activeDraft.grammarAnalysis!} />
        </AnalysisPanel>
      )}

    </div>
  );
}
