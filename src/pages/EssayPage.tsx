import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { Button } from '@mantine/core';
import { functions } from '../firebase';
import { useEssay } from '../hooks/useEssay';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { scoreColor, relativeTime, collectAnnotations, scoreTooltip } from '../utils';
import { TRAIT_LABELS } from '../types';
import type { TraitKey } from '../types';
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
import { createDraftEntity } from '../entities/draftEntity';
import { presentDraft } from '../entities/draftPresentation';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { useAnalysisActions } from '../hooks/useAnalysisActions';
import type { ActionKey } from '../hooks/useAnalysisActions';

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
  const { updateData: updateNavbar, set: setNavbar } = useNavbarContext();
  const [activeTrait, setActiveTrait] = useState<TraitKey | null>(null);
  const [selectedDraftId, setSelectedDraftId] = useState<string | null>(null);
  const activeView = viewFromPath(location.pathname);
  const basePath = ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`;
  const setActiveView = useCallback((view: ViewMode) => {
    const suffix = view === 'essay' ? '' : `/${view}`;
    navigate(`${basePath}${suffix}`, { replace: true });
  }, [navigate, basePath]);
  const [notifBannerDismissed, setNotifBannerDismissed] = useState(
    () => sessionStorage.getItem('essaycoach_notif_dismissed') === '1'
  );
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

  // Entity + presentation layers
  const entity = useMemo(
    () => activeDraft ? createDraftEntity(activeDraft) : null,
    [activeDraft],
  );
  // presentation is computed inside the navbar effect (draftAge is time-dependent,
  // can't be a useMemo dep without causing infinite re-renders).
  // For rendering, we also compute it here for local use.
  const draftAge = activeDraft ? Date.now() - activeDraft.submittedAt.getTime() : 0;
  const presentation = entity ? presentDraft(
    entity, draftAge, !!essay?.assignmentPrompt?.trim(), isLatestDraft, !ownerUid,
  ) : null;

  // Hooks
  const editor = useDraftEditor(activeDraft, essayId, user, ownerUid, isLatestDraft);
  const actions = useAnalysisActions(entity, essayId, ownerUid, user);

  // 30s timer to force re-render for draftAge-based transitions
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!activeDraft) return;
    const interval = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(interval);
  }, [activeDraft?.id]);

  // State-driven notification when analysis completes
  const wasWaiting = useRef(false);
  useEffect(() => {
    if (!loading && entity && !entity.coachReadiness) {
      wasWaiting.current = true;
    }
    if (wasWaiting.current && entity?.coachReadiness) {
      wasWaiting.current = false;
      if (essay && entity.raw.evaluation) {
        const traits = entity.raw.evaluation.traits;
        const scores = Object.values(traits).map((t: { score: number }) => t.score);
        const avg = scores.reduce((a: number, b: number) => a + b, 0) / scores.length;
        notifyEvaluationComplete(essay.title, avg);
      }
    }
  }, [loading, entity?.coachReadiness, essay]);

  const allAnnotations = useMemo(() => {
    if (!activeDraft?.evaluation) return [];
    return collectAnnotations(activeDraft.evaluation);
  }, [activeDraft]);

  // Orchestration: report selection (composes actions.ensure + navigation)
  const handleDrawerSelectReport = useCallback((key: ReportKey) => {
    const view = key as ViewMode;
    if (view === 'transitions' || view === 'grammar' || view === 'prompt') {
      actions.ensure(view as ActionKey);
      setActiveView(view);
    } else if (view === 'essay') {
      setActiveView('essay');
    } else {
      setActiveView('overall');
    }
  }, [actions, setActiveView]);

  // Orchestration: re-analyze (crosses editor + analysis boundaries)
  const [reanalyzing, setReanalyzing] = useState(false);
  const handleReanalyze = useCallback(async () => {
    if (!activeDraft || !user) return;
    if (!window.confirm('Re-analyze this essay? This will create a new draft with fresh feedback.')) return;
    setReanalyzing(true);
    try {
      const contentToSubmit = (editor.content && editor.content !== activeDraft.content)
        ? editor.content : activeDraft.content;
      const resubmitDraft = httpsCallable(functions, 'resubmitDraft', { timeout: FUNCTION_TIMEOUT });
      await resubmitDraft({ essayId: essayId!, content: contentToSubmit, ownerUid });
      setSelectedDraftId(null);
    } catch {
      // Error handling is state-driven — the UI shows error based on state
    } finally {
      setReanalyzing(false);
    }
  }, [activeDraft, essayId, ownerUid, user, editor.content]);

  const setEssayHeader = useSetEssayHeader();
  const gdocChange = useGDocChangeDetection(essay, activeDraft ?? null, isLatestDraft);

  // Notification permission banner
  const evaluation = activeDraft?.evaluation ?? null;
  const isPending = !evaluation;
  const evalStatus = activeDraft?.evaluationStatus;
  const isEvalError = isPending && evalStatus?.stage === 'error';
  const age = activeDraft ? Date.now() - activeDraft.submittedAt.getTime() : 0;
  const isStale = isPending && !evalStatus && age >= 180000;
  const showNotifBanner = isPending && !isEvalError && !isStale && !notifBannerDismissed && shouldAskPermission();
  const dismissNotifBanner = () => {
    setNotifBannerDismissed(true);
    sessionStorage.setItem('essaycoach_notif_dismissed', '1');
  };

  const comparison = evaluation?.comparisonToPrevious ?? null;
  const isEditing = activeView === 'essay';

  // Header context
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
  }, [essay, activeDraft, editor.content]);

  // Refs for hook outputs to avoid infinite re-render loop.
  // editor/actions create new object refs each render; including them as effect deps
  // would trigger updateNavbar → NavbarProvider re-render → new objects → effect fires again.
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const actionsRef = useRef(actions);
  actionsRef.current = actions;
  const handleDrawerSelectReportRef = useRef(handleDrawerSelectReport);
  handleDrawerSelectReportRef.current = handleDrawerSelectReport;
  const handleReanalyzeRef = useRef(handleReanalyze);
  handleReanalyzeRef.current = handleReanalyze;

  // Push data to navbar context (merge-setter preserves opened).
  // presentation is computed inside (draftAge changes every render — can't be a dep).
  const presentationRef = useRef(presentation);
  presentationRef.current = presentation;

  useEffect(() => {
    if (!essay || !activeDraft || !entity) {
      setNavbar(null);
      return;
    }
    const pres = presentationRef.current;
    if (!pres) { setNavbar(null); return; }
    updateNavbar({
      entity,
      presentation: pres,
      editor: editorRef.current,
      actions: actionsRef.current,
      meta: {
        activeReport: activeView as ReportKey,
        onSelectReport: (key: ReportKey) => handleDrawerSelectReportRef.current(key),
        draftOptions: drafts.map((d) => ({ id: d.id, label: `v${d.draftNumber} — ${relativeTime(d.submittedAt)}` })),
        onPickDraft: setSelectedDraftId,
        onReanalyze: () => handleReanalyzeRef.current(),
        reanalyzing,
        gdocChanged: gdocChange.changed,
        gdocLastChecked: gdocChange.lastChecked,
      },
    });
    return () => setNavbar(null);
  }, [essay, activeDraft, entity, activeView, reanalyzing, gdocChange.changed, gdocChange.lastChecked, drafts, updateNavbar, setNavbar]);

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
                      <span
                        style={{ color: scoreColor(evaluation.traits[activeTrait].score), fontWeight: 700 }}
                        title={scoreTooltip(evaluation.traits[activeTrait].score)}
                      >
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
          {!ownerUid && actions.retryCount < 3 ? (
            <Button onClick={actions.rerunOverall} size="sm" mt={8} disabled={actions.retrying} loading={actions.retrying}>
              Retry
            </Button>
          ) : ownerUid ? (
            <p style={{ marginTop: 8 }}>Only the essay owner can retry evaluation.</p>
          ) : (
            <p style={{ marginTop: 8 }}>Maximum retries reached. Please try again later.</p>
          )}
        </div>
      )}

      {/* Feedback summary — only on overall tab, only when evaluation exists */}
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
              value={editor.content}
              onChange={(e) => editor.onChange(e.target.value)}
              onPaste={(e) => handleRichPaste(e, editor.onChange)}
            />
            <div className="essay-editor-footer">
              <span className={`essay-editor-save-status${editor.saveError ? ' essay-editor-save-error' : ''}`}>
                {editor.saveError ? `Save failed: ${editor.saveError}` : editor.saving ? 'Saving...' : editor.lastSaved ? `Saved ${relativeTime(editor.lastSaved)}` : ''}
              </span>
              <Button size="compact-xs" variant="default" onClick={editor.save} disabled={editor.saving} loading={editor.saving}>
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
                onClick={actions.rerunOverall}
                disabled={actions.retrying}
                title="Re-run evaluation on the current draft"
              >
                {actions.retrying ? '↻ Running...' : '↻ Re-run'}
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
          error={actions.errors.transitions}
          loading={actions.loading.transitions}
          status={activeDraft.transitionStatus}
          onRetry={() => { actions.ensure('transitions'); }}
          onRerun={() => { actions.rerun('transitions'); }}
          rerunLoading={actions.loading.transitions}
          defaultMessage="Analyzing transitions..."
          placeholder="Transitions analysis is loading..."
        >
          <TransitionView content={activeDraft.content} analysis={activeDraft.transitionAnalysis!} />
        </AnalysisPanel>
      )}

      {activeView === 'grammar' && (
        <AnalysisPanel
          data={activeDraft.grammarAnalysis}
          error={actions.errors.grammar}
          loading={actions.loading.grammar}
          status={activeDraft.grammarStatus}
          onRetry={() => { actions.ensure('grammar'); }}
          onRerun={() => { actions.rerun('grammar'); }}
          rerunLoading={actions.loading.grammar}
          defaultMessage="Analyzing grammar..."
          placeholder="Grammar analysis is loading..."
        >
          <GrammarView content={activeDraft.content} analysis={activeDraft.grammarAnalysis!} />
        </AnalysisPanel>
      )}

      {activeView === 'prompt' && (
        <AnalysisPanel
          data={activeDraft.promptAnalysis}
          error={actions.errors.prompt}
          loading={actions.loading.prompt}
          status={activeDraft.promptStatus}
          onRetry={() => { actions.ensure('prompt'); }}
          onRerun={() => { actions.rerun('prompt'); }}
          rerunLoading={actions.loading.prompt}
          defaultMessage="Analyzing prompt adherence..."
          placeholder="Prompt analysis is loading..."
        >
          <PromptAnalysisView analysis={activeDraft.promptAnalysis!} />
        </AnalysisPanel>
      )}

    </div>
  );
}
