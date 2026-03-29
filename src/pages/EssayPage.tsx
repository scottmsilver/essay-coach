import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Button } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { functions, db } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { scoreColor, relativeTime, collectAnnotations } from '../utils';
import { TRAIT_LABELS } from '../types';
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
import { FUNCTION_TIMEOUT } from '../utils/submitEssay';
import RevisionJourney from '../components/RevisionJourney';
import { useNavbarContext } from '../hooks/useNavbarContext';
import { useGDocChangeDetection } from '../hooks/useGDocChangeDetection';
import type { ReportKey } from '../types';

type ViewMode = 'essay' | 'overall' | 'transitions' | 'grammar' | 'prompt';

function viewFromPath(pathname: string): ViewMode {
  if (pathname.endsWith('/transitions')) return 'transitions';
  if (pathname.endsWith('/grammar')) return 'grammar';
  if (pathname.endsWith('/prompt')) return 'prompt';
  if (pathname.endsWith('/overall')) return 'overall';
  return 'essay';
}

export default function EssayPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);
  const { set: setNavbar } = useNavbarContext();
  const [activeTrait, setActiveTrait] = useState<TraitKey | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [retrying, setRetrying] = useState(false);
  const activeView = viewFromPath(location.pathname);
  const basePath = ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`;
  const isEditing = activeView === 'essay';
  const setActiveView = useCallback((view: ViewMode) => {
    const suffix = view === 'essay' ? '' : `/${view}`;
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
  const [revisionContent, setRevisionContent] = useState('');
  const [resubmitError] = useState<string | null>(null);
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
  const isLatestDraft = drafts.length > 0 && activeDraft?.id === drafts[0].id;


  // Initialize revision content when landing on essay tab
  const essayInitRef = useRef(false);
  useEffect(() => {
    if (essayInitRef.current || !activeDraft) return;
    if (activeView === 'essay' || !revisionContent) {
      essayInitRef.current = true;
      const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
      setRevisionContent(saved ?? activeDraft.content);
    }
  }, [activeView, activeDraft, essayId, revisionContent]);

  // Toast + browser notification when evaluation completes
  // Toast when all analyses are complete (coach synthesis arrives last)
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (!loading && activeDraft && !activeDraft.coachSynthesis) {
      wasWaiting.current = true;
    }
    if (wasWaiting.current && activeDraft?.coachSynthesis) {
      wasWaiting.current = false;
      notifications.show({
        title: 'Analysis Complete',
        message: 'All reports are ready.',
        color: 'green',
        autoClose: 5000,
      });
      if (essay && activeDraft.evaluation) {
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

  const handleGrammarRerun = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { grammarAnalysis: null, grammarStatus: null });
    await runGrammarAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runGrammarAnalysis]);

  const handleTransitionRerun = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { transitionAnalysis: null, transitionStatus: null });
    await runTransitionAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runTransitionAnalysis]);

  const handlePromptRerun = useCallback(async () => {
    if (!activeDraft || !user) return;
    const uid = ownerUid ?? user.uid;
    const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
    await updateDoc(draftRef, { promptAnalysis: null, promptStatus: null });
    await runPromptAnalysis(activeDraft.id);
  }, [activeDraft, essayId, ownerUid, user, runPromptAnalysis]);

  const handleOverallRerun = useCallback(async () => {
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

  const [reanalyzing, setReanalyzing] = useState(false);
  const handleReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    if (!window.confirm('Re-analyze this essay? This will create a new draft with fresh feedback.')) return;
    setReanalyzing(true);
    try {
      // Use latest content: revisionContent for inline edits, activeDraft.content as fallback
      // For Google Docs, the cloud function will re-fetch from the doc
      const contentToSubmit = (revisionContent && revisionContent !== activeDraft.content)
        ? revisionContent : activeDraft.content;
      const resubmitDraft = httpsCallable(functions, 'resubmitDraft', { timeout: FUNCTION_TIMEOUT });
      await resubmitDraft({ essayId: essayId!, content: contentToSubmit, ownerUid });
      setSelectedDraftId(null); // auto-switch to newest draft
      notifications.show({ title: 'Re-analyzing', message: 'New draft created with fresh analysis.', color: 'blue', autoClose: 4000 });
    } catch {
      notifications.show({ title: 'Re-analyze failed', message: 'Please try again.', color: 'red', autoClose: 4000 });
    } finally {
      setReanalyzing(false);
    }
  }, [activeDraft, essayId, ownerUid, user]);


  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const revisionContentRef = useRef(revisionContent);
  revisionContentRef.current = revisionContent;

  // Reset editor state when draft changes
  const prevDraftIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeDraft) return;
    if (prevDraftIdRef.current !== activeDraft.id) {
      prevDraftIdRef.current = activeDraft.id;
      setLastSaved(activeDraft.editedAt ?? null);
      // Reset revision content to the new draft's content
      const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
      setRevisionContent(saved ?? activeDraft.content);
      essayInitRef.current = true;
    }
  }, [activeDraft, essayId]);

  const saveDraftToFirestore = useCallback(async (showToast = false) => {
    if (!activeDraft || !user || ownerUid || !isLatestDraft) return;
    const content = revisionContentRef.current;
    if (content === activeDraft.content) return; // Nothing changed
    setSaving(true);
    try {
      const uid = user.uid;
      const draftRef = doc(db, `users/${uid}/essays/${essayId}/drafts/${activeDraft.id}`);
      await updateDoc(draftRef, { content, editedAt: serverTimestamp() });
      localStorage.removeItem(`essaycoach_autosave_${essayId}`);
      setLastSaved(new Date());
      if (showToast) {
        notifications.show({ title: 'Saved', message: 'Draft saved.', color: 'green', autoClose: 2000 });
      }
    } catch {
      if (showToast) {
        notifications.show({ title: 'Save failed', message: 'Could not save.', color: 'red', autoClose: 4000 });
      }
    } finally {
      setSaving(false);
    }
  }, [activeDraft, user, ownerUid, essayId, isLatestDraft]);

  const handleSaveDraft = useCallback(async () => {
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    await saveDraftToFirestore(true);
  }, [saveDraftToFirestore]);

  const handleRevisionContentChange = useCallback((newContent: string) => {
    setRevisionContent(newContent);
    localStorage.setItem(`essaycoach_autosave_${essayId}`, newContent);
    if (autoSaveTimer.current) clearTimeout(autoSaveTimer.current);
    autoSaveTimer.current = setTimeout(() => saveDraftToFirestore(false), 3000);
  }, [essayId, saveDraftToFirestore]);




  const setEssayHeader = useSetEssayHeader();
  const gdocChange = useGDocChangeDetection(essay, activeDraft ?? null, isLatestDraft);

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
      draftLabel: activeDraft.editedAt
        ? `v${activeDraft.draftNumber} — edited, needs re-analysis`
        : gdocChange.changed
        ? `v${activeDraft.draftNumber} — doc changed, needs re-analysis`
        : `v${activeDraft.draftNumber} — ${relativeTime(activeDraft.submittedAt)}`,
    });
    return () => setEssayHeader(null);
  }, [essay, activeDraft, revisionContent]);

  const handleDrawerSelectReport = useCallback((key: ReportKey) => {
    const view = key as ViewMode;
    if (view === 'transitions') handleTransitionsTab();
    else if (view === 'grammar') handleGrammarTab();
    else if (view === 'prompt') handlePromptTab();
    else if (view === 'essay') {
      // Initialize revision content when first switching to essay tab
      if (!revisionContent && activeDraft) {
        const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
        setRevisionContent(saved ?? activeDraft.content);
      }
      setActiveView('essay');
    }
    else setActiveView('overall');
  }, [handleTransitionsTab, handleGrammarTab, handlePromptTab, setActiveView, activeDraft, essayId, revisionContent]);

  // Set navbar props for the coach drawer (rendered by Layout)
  useEffect(() => {
    if (!essay || !activeDraft) {
      setNavbar(null);
      return;
    }
    const draftAge = Date.now() - activeDraft.submittedAt.getTime();
    setNavbar({
      opened: true,
      drawerProps: {
        synthesis: activeDraft.coachSynthesis,
        synthesisStatus: activeDraft.coachSynthesisStatus,
        activeReport: activeView as ReportKey,
        onSelectReport: handleDrawerSelectReport,
        hasPrompt: !!essay.assignmentPrompt?.trim(),
        isOwner: !ownerUid,
        isLatestDraft,
        hasUnsavedEdits: revisionContent !== '' && revisionContent !== activeDraft.content,
        draftAge,
        reportLoading: (() => {
          // Show spinner if analysis is missing AND (status exists OR draft is very fresh)
          const isFresh = draftAge < 60000; // < 1 minute old
          return {
            overall: !activeDraft.evaluation && (!!activeDraft.evaluationStatus || isFresh),
            grammar: !activeDraft.grammarAnalysis && (!!activeDraft.grammarStatus || isFresh),
            transitions: !activeDraft.transitionAnalysis && (!!activeDraft.transitionStatus || isFresh),
            prompt: !activeDraft.promptAnalysis && (!!activeDraft.promptStatus || isFresh) && !!essay.assignmentPrompt?.trim(),
          };
        })(),
        rawIssueCounts: {
          overall: activeDraft.evaluation
            ? Object.values(activeDraft.evaluation.traits).filter((t) => t.revisionPriority !== null).length
            : undefined,
          grammar: activeDraft.grammarAnalysis
            ? activeDraft.grammarAnalysis.summary.totalErrors
            : undefined,
          transitions: activeDraft.transitionAnalysis
            ? [...activeDraft.transitionAnalysis.paragraphTransitions, ...activeDraft.transitionAnalysis.sentenceTransitions].filter((t) => t.quality === 'weak' || t.quality === 'missing').length
            : undefined,
          prompt: activeDraft.promptAnalysis
            ? activeDraft.promptAnalysis.summary.emptyCells + activeDraft.promptAnalysis.summary.partialCells
            : undefined,
        },
        onReanalyze: handleReanalyze,
        reanalyzing,
        draftOptions: drafts.map((d) => ({ id: d.id, label: `v${d.draftNumber} — ${relativeTime(d.submittedAt)}` })),
        activeDraftId: activeDraft.id,
        onPickDraft: setSelectedDraftId,
        lastSaved,
        gdocChanged: gdocChange.changed,
        gdocLastChecked: gdocChange.lastChecked,
      },
    });
    return () => setNavbar(null);
  }, [essay, activeDraft, activeView, ownerUid, setNavbar, handleDrawerSelectReport, isLatestDraft, evaluation, revisionContent, lastSaved, reanalyzing, handleReanalyze, gdocChange.changed, gdocChange.lastChecked]);

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

      {/* Resubmit error */}
      {isEditing && resubmitError && (
        <div className="error-state" style={{ margin: '0 16px' }}>{resubmitError}</div>
      )}

      {/* Score bar — sticky below breadcrumb */}
      {activeView === 'overall' && (
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
      {isPending && (isEvalError || isStale) && activeView === 'overall' && (
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
      {activeView === 'overall' && evaluation && (
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

      {/* Revision journey when coach says ready */}
      {activeView === 'overall' && activeDraft.coachSynthesis?.readiness === 'ready' && drafts.length > 1 && (
        <RevisionJourney drafts={drafts} />
      )}

      {/* Essay panel */}
      {activeView === 'essay' && (
        essay?.contentSource ? (
          <div className="essay-gdoc-panel">
            <div className="essay-gdoc-toolbar">
              <a
                href={`https://docs.google.com/document/d/${essay.contentSource.docId}/edit`}
                target="_blank"
                rel="noopener noreferrer"
                className="essay-gdoc-edit-link"
              >
                Edit in Google Docs ↗
              </a>
              {gdocChange.changed && (
                <span className="essay-gdoc-changed-badge">Document updated</span>
              )}
            </div>
            <div className="essay-gdoc-preview">
              {activeDraft.content.split('\n').map((para, i) => (
                para.trim() ? <p key={i}>{para}</p> : null
              ))}
            </div>
          </div>
        ) : (
          <div className="essay-editor-panel">
            <textarea
              className="essay-editor revision-editor-active"
              value={revisionContent}
              onChange={(e) => handleRevisionContentChange(e.target.value)}
              onPaste={(e) => handleRichPaste(e, handleRevisionContentChange)}
            />
            <div className="essay-editor-footer">
              <span className="essay-editor-save-status">
                {saving ? 'Saving...' : lastSaved ? `Saved ${relativeTime(lastSaved)}` : ''}
              </span>
              <Button size="compact-xs" variant="default" onClick={handleSaveDraft} disabled={saving} loading={saving}>
                Save
              </Button>
            </div>
          </div>
        )
      )}

      {/* Essay with inline annotations or plain text when pending */}
      {activeView === 'overall' && (
        evaluation ? (
          <>
            <AnnotatedEssay
              content={activeDraft.content}
              annotations={allAnnotations}
              readOnly
              activeTrait={activeTrait}
            />
            <div className="analysis-rerun">
              <button
                className="analysis-rerun-btn"
                onClick={handleOverallRerun}
                disabled={retrying}
                title="Re-run evaluation on the current draft"
              >
                {retrying ? '↻ Running...' : '↻ Re-run'}
              </button>
            </div>
          </>
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
          onRerun={handleTransitionRerun}
          rerunLoading={transitionLoading}
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
          onRerun={handleGrammarRerun}
          rerunLoading={grammarLoading}
          defaultMessage="Analyzing grammar..."
          placeholder="Grammar analysis is loading..."
        >
          <GrammarView content={activeDraft.content} analysis={activeDraft.grammarAnalysis!} />
        </AnalysisPanel>
      )}

      {activeView === 'prompt' && (
        <AnalysisPanel
          data={activeDraft.promptAnalysis}
          error={promptError}
          loading={promptLoading}
          status={activeDraft.promptStatus}
          onRetry={handlePromptTab}
          onRerun={handlePromptRerun}
          rerunLoading={promptLoading}
          defaultMessage="Analyzing prompt adherence..."
          placeholder="Prompt analysis is loading..."
        >
          <PromptAnalysisView analysis={activeDraft.promptAnalysis!} />
        </AnalysisPanel>
      )}

    </div>
  );
}
