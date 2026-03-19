import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, collection, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Button, Text } from '@mantine/core';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import DocBar from '../components/DocBar';
import { useEssay } from '../hooks/useEssay';
import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey } from '../types';
import { handleRichPaste } from '../utils/pasteHandler';
import { fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import { scoreColor, collectAnnotations, classifyAnnotation } from '../utils';
import ScorePillBar from '../components/ScorePillBar';
import { fireAllAnalyses } from '../utils/submitEssay';

export default function RevisionPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);
  const [selectedTrait, setSelectedTrait] = useState<TraitKey | null>(null);
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);
  const [refetching, setRefetching] = useState(false);
  const initialized = useRef(false);

  const latestDraft = drafts[0];

  // Initialize content ONCE from localStorage or draft — not on every snapshot
  useEffect(() => {
    if (!latestDraft || initialized.current) return;
    initialized.current = true;
    const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
    setContent(saved ?? latestDraft.content);
    if (latestDraft.evaluation) {
      const prioritized = TRAIT_KEYS
        .filter((t) => latestDraft.evaluation!.traits[t].revisionPriority !== null)
        .sort((a, b) => (latestDraft.evaluation!.traits[a].revisionPriority! - latestDraft.evaluation!.traits[b].revisionPriority!));
      if (prioritized.length > 0) setSelectedTrait(prioritized[0]);
    }
  }, [latestDraft, essayId]);

  const allAnnotations = useMemo(() => {
    if (!latestDraft?.evaluation) return [];
    return collectAnnotations(latestDraft.evaluation);
  }, [latestDraft]);

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
    localStorage.setItem(`essaycoach_autosave_${essayId}`, newContent);
  }, [essayId]);

  const handleResubmit = async () => {
    if (retryCount >= 3 || !essayId || !user || !latestDraft || ownerUid) return;
    setSubmitting(true);
    setError(null);
    try {
      let essayContent = content;

      // Re-fetch from Google Docs if content is doc-sourced
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
      const newDraftNumber = (essay?.currentDraftNumber ?? latestDraft.draftNumber) + 1;
      const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
      const draftRef = doc(collection(db, `users/${uid}/essays/${essayId}/drafts`));

      await Promise.all([
        setDoc(draftRef, {
          draftNumber: newDraftNumber,
          content: essayContent,
          submittedAt: serverTimestamp(),
          grammarStatus: { stage: 'pending', message: 'Queued...' },
          transitionStatus: { stage: 'pending', message: 'Queued...' },
        }),
        updateDoc(essayRef, {
          currentDraftNumber: newDraftNumber,
          updatedAt: serverTimestamp(),
        }),
      ]);

      localStorage.removeItem(`essaycoach_autosave_${essayId}`);
      navigate(`/essay/${essayId}`);

      // Fire all 3 analyses in parallel (fire-and-forget)
      fireAllAnalyses(essayId!, draftRef.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to resubmit. Please try again.');
      setRetryCount((c) => c + 1);
      setSubmitting(false);
    }
  };

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading...</p></div>;
  if (!essay || !latestDraft?.evaluation) return <div>Essay not found or not yet evaluated.</div>;

  const evaluation = latestDraft.evaluation;

  return (
    <div className="essay-page">
      <DocBar title={`${essay.title} — Revision`} />

      {error && <div className="error-state" style={{ marginBottom: 0, padding: '4px 12px', fontSize: 12 }}>{error}</div>}

      {/* Row 2 — Score pills + Resubmit */}
      <div className="analysis-bar">
        <ScorePillBar
          evaluation={evaluation}
          activeKey={selectedTrait}
          onSelect={setSelectedTrait}
          showPriority
        />
        <div className="analysis-bar-right">
          {!ownerUid && (
            <Button size="compact-sm" onClick={handleResubmit} disabled={submitting || retryCount >= 3} loading={submitting || refetching}>
              {refetching ? 'Re-importing...' : 'Resubmit'}
            </Button>
          )}
        </div>
      </div>

      {/* Trait feedback panel */}
      {selectedTrait && (
        <div className="trait-feedback-panel">
          <div className="trait-feedback-header">
            <strong>{TRAIT_LABELS[selectedTrait]}</strong>
            <span className="trait-feedback-score" style={{ color: scoreColor(evaluation.traits[selectedTrait].score) }}>
              {evaluation.traits[selectedTrait].score}/6
            </span>
          </div>
          <p className="trait-feedback-text">{evaluation.traits[selectedTrait].feedback}</p>
        </div>
      )}

      {/* Revision plan */}
      {evaluation.revisionPlan.length > 0 && (
        <div className="revision-plan-inline">
          <strong>Focus on:</strong>
          <ol>
            {evaluation.revisionPlan.map((step, i) => <li key={i}>{step}</li>)}
          </ol>
        </div>
      )}

      {/* Essay editor with annotation sidebar for reference */}
      <div className="revision-layout">
        <div className="revision-editor">
          {essay?.contentSource ? (
            <div style={{ padding: 16, background: 'var(--mantine-color-gray-0)', borderRadius: 8, height: '100%' }}>
              <Text size="sm" c="dimmed" mb="sm">
                This essay is linked to a Google Doc. Edit your essay in Google Docs, then click Resubmit to re-import and evaluate the latest version.
              </Text>
              <Text size="sm" style={{ whiteSpace: 'pre-wrap' }}>{content}</Text>
            </div>
          ) : (
            <textarea
              className="essay-editor"
              value={content}
              onChange={(e) => handleContentChange(e.target.value)}
              onPaste={(e) => handleRichPaste(e, handleContentChange)}
            />
          )}
        </div>
        <div className="revision-annotations">
          <div className="revision-annotations-header">Feedback</div>
          {(selectedTrait
            ? allAnnotations.filter(a => a.traitKey === selectedTrait)
            : allAnnotations
          ).map((ann, i) => (
            <div key={i} className={`sidebar-comment ${classifyAnnotation(ann.comment)}`} style={{ position: 'static' }}>
              <span className="sidebar-comment-trait">{ann.traitLabel}</span>
              <span className="sidebar-comment-text">{ann.comment}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
