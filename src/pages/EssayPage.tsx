import { useState, useMemo, useCallback, useEffect, useRef } from 'react';
import { useParams, useLocation, useNavigate } from 'react-router-dom';
import { doc, updateDoc, setDoc, collection, serverTimestamp } from 'firebase/firestore';
import { Button } from '@mantine/core';
import { db } from '../firebase';
import { fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import { useEssay } from '../hooks/useEssay';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { scoreColor, relativeTime, collectAnnotations, collectCriteriaAnnotations, collectCoherenceAnnotations, collectStructureAnnotations, scoreLabel } from '../utils';
import { TRAIT_LABELS } from '../types';
import type { TraitKey } from '../types';
import { useSetEssayHeader } from '../hooks/useEssayHeaderContext';
import ScorePillBar from '../components/ScorePillBar';
import AnalysisPanel from '../components/AnalysisPanel';
import AnnotatedEssay from '../components/AnnotatedEssay';
import TransitionView from '../components/TransitionView';
import GrammarView from '../components/GrammarView';
import DuplicationView from '../components/DuplicationView';
import PromptAnalysisView from '../components/PromptAnalysisView';
import { CriteriaPanel, CriteriaEmptyState } from '../components/CriteriaPanel';
import { CoherencePanel, CoherenceEmptyState } from '../components/CoherencePanel';
import { StructurePanel, StructureEmptyState } from '../components/StructurePanel';
import { shouldAskPermission, requestPermission, notifyEvaluationComplete } from '../utils/notifications';
import { handleRichPaste } from '../utils/pasteHandler';
import RevisionJourney from '../components/RevisionJourney';
import EssaySettingsModal, { type EssaySettingsUpdate } from '../components/EssaySettingsModal';
import { useNavbarContext } from '../hooks/useNavbarContext';
import { useGDocChangeDetection } from '../hooks/useGDocChangeDetection';
import type { ReportKey, DocSource } from '../types';
import { COHERENCE_ENABLED } from '../../shared/coherenceTypes';
import { STRUCTURE_ENABLED } from '../../shared/structureTypes';
import { createDraftEntity } from '../entities/draftEntity';
import { presentDraft } from '../entities/draftPresentation';
import { useDraftEditor } from '../hooks/useDraftEditor';
import { useAnalysisActions } from '../hooks/useAnalysisActions';
import type { ActionKey } from '../hooks/useAnalysisActions';

type ViewMode = 'essay' | 'overall' | 'transitions' | 'grammar' | 'prompt' | 'duplication' | 'criteria' | 'coherence' | 'structure';

function viewFromPath(pathname: string): ViewMode {
  if (pathname.endsWith('/transitions')) return 'transitions';
  if (pathname.endsWith('/grammar')) return 'grammar';
  if (pathname.endsWith('/prompt')) return 'prompt';
  if (pathname.endsWith('/duplication')) return 'duplication';
  if (pathname.endsWith('/criteria')) return 'criteria';
  if (pathname.endsWith('/coherence')) return 'coherence';
  if (pathname.endsWith('/structure')) return 'structure';
  if (pathname.endsWith('/overall')) return 'overall';
  return 'essay';
}

function countParagraphs(content: string): number {
  return content.trim().split(/\n\s*\n+/).filter((p) => p.trim()).length;
}

export default function EssayPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);
  const { updateData: updateNavbar, set: setNavbar } = useNavbarContext();
  const [activeTrait, setActiveTrait] = useState<TraitKey | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
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
  const hasCoherence = COHERENCE_ENABLED && !!activeDraft && countParagraphs(activeDraft.content) > 1;
  const hasStructure = STRUCTURE_ENABLED && !!activeDraft && countParagraphs(activeDraft.content) > 1;
  const presentation = entity ? presentDraft(
    entity, draftAge, !!essay?.assignmentPrompt?.trim(), isLatestDraft, !ownerUid, !!essay?.teacherCriteria, hasCoherence, hasStructure,
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
    if (activeView === 'criteria' && activeDraft?.criteriaAnalysis) {
      return collectCriteriaAnnotations(activeDraft.criteriaAnalysis);
    }
    if (activeView === 'coherence' && activeDraft?.coherenceAnalysis) {
      return collectCoherenceAnnotations(activeDraft.coherenceAnalysis);
    }
    if (activeView === 'structure' && activeDraft?.structureAnalysis) {
      return collectStructureAnnotations(activeDraft.structureAnalysis, activeDraft.content);
    }
    if (activeView === 'overall' && activeDraft?.evaluation) {
      return collectAnnotations(activeDraft.evaluation);
    }
    return [];
  }, [activeView, activeDraft]);

  // Orchestration: report selection (composes actions.ensure + navigation)
  const handleDrawerSelectReport = useCallback((key: ReportKey) => {
    const view = key as ViewMode;
    if (view === 'transitions' || view === 'grammar' || view === 'prompt' || view === 'duplication' || view === 'criteria' || view === 'coherence' || view === 'structure') {
      actions.ensure(view as ActionKey);
      setActiveView(view);
    } else if (view === 'essay') {
      setActiveView('essay');
    } else {
      setActiveView('overall');
    }
  }, [actions, setActiveView]);

  // Orchestration: re-analyze (crosses editor + analysis boundaries).
  //
  // Creates the next draft directly in Firestore — same pattern NewEssayPage
  // uses — so the UI switches to the new draft's "Analyzing..." state as soon
  // as the write settles (roughly one RTT) instead of waiting 15-30s for the
  // server-side evaluation to finish inside a callable. The onDraftCreated
  // Firestore trigger picks it up and runs every analysis.
  const [reanalyzing, setReanalyzing] = useState(false);
  const handleReanalyze = useCallback(async () => {
    if (!activeDraft || !user || !essay || !essayId) return;
    if (!window.confirm('Re-analyze this essay? This will create a new draft with fresh feedback.')) return;
    setReanalyzing(true);
    try {
      const uid = ownerUid ?? user.uid;
      const userEdited = !!editor.content && editor.content !== activeDraft.content;
      let content = userEdited ? editor.content : activeDraft.content;

      // Refresh from the Google Doc when the student hasn't locally edited —
      // the "Doc updated — re-analyze to refresh" banner promises this, and
      // it's where moved/deleted bookmarks surface as a fixable error.
      if (!userEdited && essay.contentSource) {
        try {
          const data = await fetchGDocInfo(essay.contentSource.docId, essay.contentSource.tab);
          const sections = parseSections(data.text, data.bookmarks);
          const idx = essay.contentSource.sectionIndex;
          if (idx < 0 || idx >= sections.length) {
            window.alert(
              `The bookmarked section in your Google Doc can't be found — it may have been moved or deleted.\n\nOpen settings to re-pick the section.`
            );
            setSettingsOpen(true);
            setReanalyzing(false);
            return;
          }
          content = sections[idx].replace(/^[\n ]+/, '').replace(/\s+$/, '');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.warn('GDoc re-fetch failed; continuing with stored content:', msg);
        }
      }

      const latestDraftNumber = drafts[0]?.draftNumber ?? activeDraft.draftNumber;
      const nextDraftNumber = latestDraftNumber + 1;
      const essayRef = doc(db, 'users', uid, 'essays', essayId);
      const draftRef = doc(collection(db, 'users', uid, 'essays', essayId, 'drafts'));

      await Promise.all([
        setDoc(draftRef, {
          draftNumber: nextDraftNumber,
          content,
          submittedAt: serverTimestamp(),
          evaluationStatus: { stage: 'pending', message: 'Queued...' },
          grammarStatus: { stage: 'pending', message: 'Queued...' },
          transitionStatus: { stage: 'pending', message: 'Queued...' },
        }),
        updateDoc(essayRef, {
          currentDraftNumber: nextDraftNumber,
          updatedAt: serverTimestamp(),
        }),
      ]);

      setSelectedDraftId(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to start re-analyze.';
      window.alert(msg);
    } finally {
      setReanalyzing(false);
    }
  }, [activeDraft, essay, essayId, ownerUid, user, editor.content, drafts]);

  // Orchestration: save teacher criteria (Firestore write + clear analysis)
  const isOwner = !ownerUid;
  const handleSaveCriteria = useCallback(async (text: string, source: DocSource | null) => {
    if (!essayId || !user) return;
    const uid = ownerUid ?? user.uid;
    const essayRef = doc(db, 'users', uid, 'essays', essayId);
    await updateDoc(essayRef, {
      teacherCriteria: text.trim() || null,
      criteriaSource: source,
    });
    // Clear criteria analysis on current draft to trigger re-analysis
    if (activeDraft) {
      const draftRef = doc(db, 'users', uid, 'essays', essayId, 'drafts', activeDraft.id);
      await updateDoc(draftRef, {
        criteriaAnalysis: null,
        criteriaStatus: null,
        criteriaSnapshot: null,
      });
    }
  }, [essayId, user, ownerUid, activeDraft]);

  const handleSaveSettings = useCallback(async (updates: EssaySettingsUpdate) => {
    if (!essayId || !user) return;
    const uid = ownerUid ?? user.uid;
    const essayRef = doc(db, 'users', uid, 'essays', essayId);

    const promptChanged = updates.assignmentPrompt !== essay?.assignmentPrompt;
    const criteriaChanged = (updates.teacherCriteria ?? '') !== (essay?.teacherCriteria ?? '');
    const typeChanged = updates.writingType !== essay?.writingType;

    await updateDoc(essayRef, {
      title: updates.title,
      writingType: updates.writingType,
      assignmentPrompt: updates.assignmentPrompt,
      promptSource: updates.promptSource,
      teacherCriteria: updates.teacherCriteria,
      criteriaSource: updates.criteriaSource,
    });

    if (activeDraft) {
      const draftDocRef = doc(db, 'users', uid, 'essays', essayId, 'drafts', activeDraft.id);
      const clears: Record<string, null> = {};
      if (typeChanged) { clears.evaluation = null; clears.evaluationStatus = null; }
      if (promptChanged) { clears.promptAnalysis = null; clears.promptStatus = null; }
      if (criteriaChanged) { clears.criteriaAnalysis = null; clears.criteriaStatus = null; clears.criteriaSnapshot = null; }
      if (Object.keys(clears).length > 0) {
        await updateDoc(draftDocRef, clears);
      }
    }
  }, [essayId, user, ownerUid, essay, activeDraft]);

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
      onOpenSettings: () => setSettingsOpen(true),
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
        onOpenSettings: () => setSettingsOpen(true),
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
                      <span style={{ color: scoreColor(evaluation.traits[activeTrait].score), fontWeight: 700 }}>
                        {evaluation.traits[activeTrait].score}/6 {scoreLabel(evaluation.traits[activeTrait].score)}
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

      {activeView === 'duplication' && (
        <AnalysisPanel
          data={activeDraft.duplicationAnalysis}
          error={actions.errors.duplication}
          loading={actions.loading.duplication}
          status={activeDraft.duplicationStatus}
          onRetry={() => { actions.ensure('duplication'); }}
          onRerun={() => { actions.rerun('duplication'); }}
          rerunLoading={actions.loading.duplication}
          defaultMessage="Finding repeated ideas..."
          placeholder="Duplication analysis is loading..."
        >
          <DuplicationView content={activeDraft.content} analysis={activeDraft.duplicationAnalysis!} />
        </AnalysisPanel>
      )}

      {activeView === 'criteria' && (
        essay.teacherCriteria ? (
          <AnalysisPanel
            data={activeDraft.criteriaAnalysis}
            error={actions.errors.criteria}
            loading={actions.loading.criteria}
            status={activeDraft.criteriaStatus}
            onRetry={() => { actions.ensure('criteria'); }}
            onRerun={() => { actions.rerun('criteria'); }}
            rerunLoading={actions.loading.criteria}
            defaultMessage="Analyzing criteria..."
            placeholder="Criteria analysis is loading..."
          >
            <CriteriaPanel
              analysis={activeDraft.criteriaAnalysis!}
              teacherCriteria={essay.teacherCriteria}
              criteriaSource={essay.criteriaSource ?? null}
              isOwner={isOwner}
              onSaveCriteria={handleSaveCriteria}
              collapsible
            />
            <AnnotatedEssay
              content={activeDraft.content}
              annotations={allAnnotations}
              readOnly
            />
          </AnalysisPanel>
        ) : (
          <CriteriaEmptyState isOwner={isOwner} onSaveCriteria={handleSaveCriteria} />
        )
      )}

      {activeView === 'coherence' && (
        hasCoherence ? (
          <AnalysisPanel
            data={activeDraft.coherenceAnalysis}
            error={actions.errors.coherence}
            loading={actions.loading.coherence}
            status={activeDraft.coherenceStatus}
            onRetry={() => { actions.ensure('coherence'); }}
            onRerun={() => { actions.rerun('coherence'); }}
            rerunLoading={actions.loading.coherence}
            defaultMessage="Checking thesis coherence..."
            placeholder="Coherence analysis is loading..."
          >
            <CoherencePanel analysis={activeDraft.coherenceAnalysis!} />
            <AnnotatedEssay
              content={activeDraft.content}
              annotations={allAnnotations}
              readOnly
            />
          </AnalysisPanel>
        ) : (
          <CoherenceEmptyState />
        )
      )}

      {activeView === 'structure' && (
        hasStructure ? (
          <AnalysisPanel
            data={activeDraft.structureAnalysis}
            error={actions.errors.structure}
            loading={actions.loading.structure}
            status={activeDraft.structureStatus}
            onRetry={() => { actions.ensure('structure'); }}
            onRerun={() => { actions.rerun('structure'); }}
            rerunLoading={actions.loading.structure}
            defaultMessage="Analyzing paragraph structure..."
            placeholder="Structure analysis is loading..."
          >
            <StructurePanel analysis={activeDraft.structureAnalysis!} />
            <AnnotatedEssay
              content={activeDraft.content}
              annotations={allAnnotations}
              readOnly
            />
          </AnalysisPanel>
        ) : (
          <StructureEmptyState />
        )
      )}

      {essay && (
        <EssaySettingsModal
          opened={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          essay={essay}
          essayId={essayId!}
          ownerUid={ownerUid}
          onSave={handleSaveSettings}
          editPageUrl={ownerUid ? `/user/${ownerUid}/essay/${essayId}/edit` : `/essay/${essayId}/edit`}
        />
      )}
    </div>
  );
}
