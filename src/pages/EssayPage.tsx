import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button, Select, Group } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { functions, db } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { scoreColor, relativeTime, collectAnnotations, classifyAnnotation } from '../utils';
import { TRAIT_LABELS, TRAIT_KEYS } from '../types';
import type { TraitKey, TransitionAnalysis, GrammarAnalysis, PromptAnalysis } from '../types';
import { useSetEssayHeader } from '../hooks/useEssayHeaderContext';
import ScorePillBar from '../components/ScorePillBar';
import AnalysisPanel from '../components/AnalysisPanel';
import AnnotatedEssay from '../components/AnnotatedEssay';
import TransitionView from '../components/TransitionView';
import GrammarView from '../components/GrammarView';
import PromptAnalysisView from '../components/PromptAnalysisView';
import { shouldAskPermission, requestPermission, notifyEvaluationComplete } from '../utils/notifications';
import { handleRichPaste } from '../utils/pasteHandler';
import { fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import { fireAllAnalyses, FUNCTION_TIMEOUT } from '../utils/submitEssay';

type ViewMode = 'feedback' | 'transitions' | 'grammar' | 'prompt';

function viewFromPath(pathname: string): ViewMode {
  if (pathname.endsWith('/transitions')) return 'transitions';
  if (pathname.endsWith('/grammar')) return 'grammar';
  if (pathname.endsWith('/prompt')) return 'prompt';
  return 'feedback';
}

function isRevisePath(pathname: string): boolean {
  return pathname.endsWith('/revise');
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
  const [promptLoading, setPromptLoading] = useState(false);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(
    () => sessionStorage.getItem('essaycoach_notif_dismissed') === '1'
  );
  const [revising, setRevising] = useState(() => isRevisePath(location.pathname));
  const [revisionContent, setRevisionContent] = useState('');
  const [resubmitting, setResubmitting] = useState(false);
  const [resubmitError, setResubmitError] = useState<string | null>(null);
  const [refetching, setRefetching] = useState(false);
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

  const focusHighestPriorityTrait = useCallback((evaluation: { traits: Record<string, { revisionPriority: number | null }> }) => {
    const prioritized = TRAIT_KEYS
      .filter((t) => evaluation.traits[t].revisionPriority !== null)
      .sort((a, b) => (evaluation.traits[a].revisionPriority! - evaluation.traits[b].revisionPriority!));
    if (prioritized.length > 0) setActiveTrait(prioritized[0]);
  }, []);

  // Auto-enter revision mode if URL ends with /revise and data is ready
  const reviseInitRef = useRef(false);
  useEffect(() => {
    if (reviseInitRef.current || !revising || !activeDraft) return;
    reviseInitRef.current = true;
    const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
    setRevisionContent(saved ?? activeDraft.content);
    if (activeDraft.evaluation) focusHighestPriorityTrait(activeDraft.evaluation);
  }, [revising, activeDraft, essayId, focusHighestPriorityTrait]);

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
      >(functions, 'analyzeGrammar', { timeout: FUNCTION_TIMEOUT });
      await analyzeGrammar({ essayId: essayId!, draftId, ownerUid });
    } catch {
      setGrammarError('Failed to analyze grammar. Please try again.');
    } finally {
      setGrammarLoading(false);
    }
  }, [essayId, ownerUid]);

  // Shared transition analysis caller
  const runTransitionAnalysis = useCallback(async (draftId: string) => {
    setTransitionLoading(true);
    setTransitionError(null);
    try {
      const analyzeTransitions = httpsCallable<
        { essayId: string; draftId: string; ownerUid?: string },
        TransitionAnalysis
      >(functions, 'analyzeTransitions', { timeout: FUNCTION_TIMEOUT });
      await analyzeTransitions({ essayId: essayId!, draftId, ownerUid });
    } catch {
      setTransitionError('Failed to analyze transitions. Please try again.');
    } finally {
      setTransitionLoading(false);
    }
  }, [essayId, ownerUid]);

  const handleTransitionsTab = useCallback(async () => {
    setActiveView('transitions');
    if (!activeDraft || activeDraft.transitionAnalysis) return;
    if (activeDraft.transitionStatus && activeDraft.transitionStatus.stage !== 'error') return;
    await runTransitionAnalysis(activeDraft.id);
  }, [activeDraft, runTransitionAnalysis, setActiveView]);

  const handleGrammarTab = useCallback(async () => {
    setActiveView('grammar');
    if (!activeDraft || activeDraft.grammarAnalysis) return;
    if (activeDraft.grammarStatus && activeDraft.grammarStatus.stage !== 'error') return;
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, runGrammarAnalysis, setActiveView]);

  // Shared prompt adherence analysis caller
  const runPromptAnalysis = useCallback(async (draftId: string) => {
    setPromptLoading(true);
    setPromptError(null);
    try {
      const analyzePromptAdherence = httpsCallable<
        { essayId: string; draftId: string; ownerUid?: string },
        PromptAnalysis
      >(functions, 'analyzePromptAdherence', { timeout: FUNCTION_TIMEOUT });
      await analyzePromptAdherence({ essayId: essayId!, draftId, ownerUid });
    } catch {
      setPromptError('Failed to analyze prompt adherence. Please try again.');
    } finally {
      setPromptLoading(false);
    }
  }, [essayId, ownerUid]);

  const handlePromptTab = useCallback(async () => {
    setActiveView('prompt');
    if (!activeDraft || activeDraft.promptAnalysis) return;
    if (activeDraft.promptStatus && activeDraft.promptStatus.stage !== 'error') return;
    await runPromptAnalysis(activeDraft.id);
  }, [activeDraft, runPromptAnalysis, setActiveView]);

  const handlePromptReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { promptAnalysis: null, promptStatus: null });
    await runPromptAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runPromptAnalysis]);

  const handleGrammarReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { grammarAnalysis: null, grammarStatus: null });
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runGrammarAnalysis]);

  const handleTransitionReanalyze = useCallback(async () => {
    if (!activeDraft) return;
    await runTransitionAnalysis(activeDraft.id);
  }, [activeDraft, runTransitionAnalysis]);

  const handleFeedbackReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    setRetrying(true);
    try {
      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: FUNCTION_TIMEOUT });
      await evaluateEssay({ essayId: essayId!, draftId: activeDraft.id, ownerUid, force: true });
    } catch {
      setRetryCount((c) => c + 1);
    } finally {
      setRetrying(false);
    }
  }, [activeDraft, essayId, ownerUid, user]);

  const enterRevisionMode = useCallback(() => {
    if (!activeDraft) return;
    setRevising(true);
    setResubmitError(null);
    navigate(`${basePath}/revise`, { replace: true });
    const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
    setRevisionContent(saved ?? activeDraft.content);
    if (activeDraft.evaluation) focusHighestPriorityTrait(activeDraft.evaluation);
  }, [activeDraft, essayId, navigate, basePath, focusHighestPriorityTrait]);

  const exitRevisionMode = useCallback(() => {
    setRevising(false);
    setResubmitError(null);
    reviseInitRef.current = false;
    navigate(basePath, { replace: true });
  }, [navigate, basePath]);

  const handleRevisionContentChange = useCallback((newContent: string) => {
    setRevisionContent(newContent);
    localStorage.setItem(`essaycoach_autosave_${essayId}`, newContent);
  }, [essayId]);

  const [resubmitRetryCount, setResubmitRetryCount] = useState(0);

  const handleResubmit = useCallback(async () => {
    if (resubmitRetryCount >= 3 || !essayId || !user || !activeDraft || ownerUid) return;
    setResubmitting(true);
    setResubmitError(null);
    try {
      let essayContent = revisionContent;

      if (essay?.contentSource) {
        setRefetching(true);
        try {
          const data = await fetchGDocInfo(essay.contentSource.docId, essay.contentSource.tab);
          const sections = parseSections(data.text, data.bookmarks);
          if (essay.contentSource.sectionIndex < sections.length) {
            essayContent = sections[essay.contentSource.sectionIndex];
          }
        } catch (err) {
          console.warn('Failed to re-fetch from Google Docs, using current content:', err);
        }
        setRefetching(false);
      }

      const uid = user.uid;
      const newDraftNumber = (essay?.currentDraftNumber ?? activeDraft.draftNumber) + 1;
      const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
      const draftRef = doc(collection(db, `users/${uid}/essays/${essayId}/drafts`));

      await Promise.all([
        setDoc(draftRef, {
          draftNumber: newDraftNumber,
          content: essayContent,
          submittedAt: serverTimestamp(),
          grammarStatus: { stage: 'pending', message: 'Queued...' },
          transitionStatus: { stage: 'pending', message: 'Queued...' },
          ...(essay?.assignmentPrompt?.trim() ? { promptStatus: { stage: 'pending', message: 'Queued...' } } : {}),
        }),
        updateDoc(essayRef, {
          currentDraftNumber: newDraftNumber,
          updatedAt: serverTimestamp(),
        }),
      ]);

      localStorage.removeItem(`essaycoach_autosave_${essayId}`);
      setRevising(false);
      setResubmitting(false);
      reviseInitRef.current = false;
      navigate(basePath, { replace: true });

      fireAllAnalyses(essayId, draftRef.id);
    } catch (err: unknown) {
      setResubmitError(err instanceof Error ? err.message : 'Failed to resubmit. Please try again.');
      setResubmitRetryCount((c) => c + 1);
      setResubmitting(false);
    }
  }, [essayId, user, activeDraft, ownerUid, essay, revisionContent, navigate, basePath, resubmitRetryCount]);

  const setEssayHeader = useSetEssayHeader();
  const isLatestDraft = drafts.length > 0 && activeDraft?.id === drafts[0].id;

  const handleRetry = async () => {
    if (retryCount >= 3 || !activeDraft) return;
    setRetrying(true);
    try {
      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: FUNCTION_TIMEOUT });
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

  useEffect(() => {
    if (!essay || !activeDraft) {
      setEssayHeader(null);
      return;
    }
    setEssayHeader({
      title: essay.title,
      draftLabel: revising
        ? '· Revising'
        : `v${activeDraft.draftNumber} — ${relativeTime(activeDraft.submittedAt)}`,
      activeDraftId: activeDraft.id,
      draftOptions: drafts.map((d) => ({ id: d.id, label: `v${d.draftNumber} — ${relativeTime(d.submittedAt)}` })),
      onPickDraft: setSelectedDraftId,
      toolbar: (
        <Group gap="xs">
          {revising ? (
            <>
              <Button size="compact-xs" variant="default" onClick={exitRevisionMode} disabled={resubmitting}>
                Cancel
              </Button>
              <Button
                size="compact-xs"
                onClick={handleResubmit}
                disabled={resubmitting || resubmitRetryCount >= 3}
                loading={resubmitting || refetching}
              >
                {essay?.contentSource
                  ? (refetching ? 'Re-importing...' : 'Re-import & Evaluate')
                  : 'Resubmit for Feedback'}
              </Button>
            </>
          ) : (
            <>
              <Select
                className="view-selector-blue"
                size="xs"
                value={activeView}
                onChange={(val) => {
                  const view = val as ViewMode;
                  if (view === 'transitions') handleTransitionsTab();
                  else if (view === 'grammar') handleGrammarTab();
                  else if (view === 'prompt') handlePromptTab();
                  else setActiveView('feedback');
                }}
                data={[
                  { value: 'feedback', label: 'Overall' },
                  { value: 'transitions', label: 'Transitions' },
                  { value: 'grammar', label: 'Grammar' },
                  ...(essay?.assignmentPrompt?.trim() ? [{ value: 'prompt', label: 'Prompt' }] : []),
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
                    : activeView === 'prompt' ? handlePromptReanalyze
                    : handleFeedbackReanalyze
                  }
                  disabled={
                    activeView === 'grammar' ? grammarLoading
                    : activeView === 'transitions' ? transitionLoading
                    : activeView === 'prompt' ? promptLoading
                    : retrying || retryCount >= 3
                  }
                  loading={activeView === 'grammar' ? grammarLoading : activeView === 'transitions' ? transitionLoading : activeView === 'prompt' ? promptLoading : retrying}
                >
                  Analyze
                </Button>
              )}
              {isLatestDraft && evaluation && !ownerUid && (
                <Button size="compact-xs" onClick={enterRevisionMode}>
                  Revise
                </Button>
              )}
            </>
          )}
        </Group>
      ),
    });
    return () => setEssayHeader(null);
  }, [essay, activeDraft, drafts, revising, resubmitting, resubmitRetryCount, refetching, activeView, evaluation, isLatestDraft, ownerUid, grammarLoading, transitionLoading, promptLoading, retrying, retryCount]);

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essay...</p></div>;
  if (!essay || !activeDraft) return <div>Essay not found.</div>;

  return (
    <div className="essay-page">
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

      {/* Revision mode instruction banner */}
      {revising && (
        <>
          {essay?.contentSource ? (
            <div className="revision-banner revision-banner-gdoc">
              <span className="revision-banner-icon">📄</span>
              <div className="revision-banner-text">
                <strong>Edit your essay in Google Docs</strong>
                <span>Make your revisions there, then click Re-import & Evaluate to get new feedback.</span>
              </div>
              <Button
                component="a"
                href={`https://docs.google.com/document/d/${essay.contentSource.docId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                size="compact-xs"
                variant="light"
                color="yellow"
              >
                Open in Google Docs ↗
              </Button>
            </div>
          ) : (
            <div className="revision-banner revision-banner-copypaste">
              <span className="revision-banner-icon">✏️</span>
              <div className="revision-banner-text">
                <strong>Edit your essay below or paste your revised version</strong>
                <span>Feedback is shown on the right for reference.</span>
              </div>
            </div>
          )}
          {resubmitError && (
            <div className="error-state" style={{ margin: '0 24px' }}>{resubmitError}</div>
          )}
          {evaluation && evaluation.revisionPlan.length > 0 && (
            <div className="revision-plan-inline" style={{ margin: '8px 24px' }}>
              <strong>Focus on:</strong>
              <ol>
                {evaluation.revisionPlan.map((step, i) => <li key={i}>{step}</li>)}
              </ol>
            </div>
          )}
        </>
      )}

      {/* Score bar — sticky below breadcrumb */}
      {activeView === 'feedback' && !revising && (
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
      {isPending && (isEvalError || isStale) && activeView === 'feedback' && !revising && (
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
      {activeView === 'feedback' && evaluation && !revising && (
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
        </div>
      )}

      {/* Essay with inline annotations or plain text when pending */}
      {activeView === 'feedback' && (
        revising ? (
          essay?.contentSource ? (
            // Google Docs: show annotated essay read-only (it has its own feedback sidebar)
            <AnnotatedEssay
              content={activeDraft.content}
              annotations={allAnnotations}
              readOnly
              activeTrait={activeTrait}
            />
          ) : (
            // Copy/paste: textarea + feedback sidebar
            <div className="revision-layout">
              <div className="revision-editor">
                <textarea
                  className="essay-editor revision-editor-active"
                  value={revisionContent}
                  onChange={(e) => handleRevisionContentChange(e.target.value)}
                  onPaste={(e) => handleRichPaste(e, handleRevisionContentChange)}
                />
              </div>
              <div className="revision-annotations">
                <div className="revision-annotations-header">Feedback</div>
                {(activeTrait
                  ? allAnnotations.filter(a => a.traitKey === activeTrait)
                  : allAnnotations
                ).map((ann, i) => (
                  <div key={i} className={`sidebar-comment ${classifyAnnotation(ann.comment)}`} style={{ position: 'static' }}>
                    <span className="sidebar-comment-trait">{ann.traitLabel}</span>
                    <span className="sidebar-comment-text">{ann.comment}</span>
                  </div>
                ))}
              </div>
            </div>
          )
        ) : evaluation ? (
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

      {activeView === 'transitions' && !revising && (
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

      {activeView === 'grammar' && !revising && (
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

      {activeView === 'prompt' && !revising && (
        <AnalysisPanel
          data={activeDraft.promptAnalysis}
          error={promptError}
          loading={promptLoading}
          status={activeDraft.promptStatus}
          onRetry={handlePromptTab}
          defaultMessage="Analyzing prompt adherence..."
          placeholder="Prompt analysis is loading..."
        >
          <PromptAnalysisView analysis={activeDraft.promptAnalysis!} />
        </AnalysisPanel>
      )}

    </div>
  );
}
