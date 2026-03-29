import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import type { Draft } from '../types';

export interface DraftEditorState {
  content: string;
  onChange: (content: string) => void;
  save: () => Promise<void>;
  saving: boolean;
  lastSaved: Date | null;
  hasUnsavedEdits: boolean;
}

export function useDraftEditor(
  activeDraft: Draft | undefined,
  essayId: string | undefined,
  user: { uid: string } | null,
  ownerUid: string | undefined,
  isLatestDraft: boolean,
): DraftEditorState {
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);

  const autoSaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIdRef = useRef<string | undefined>(undefined);
  const contentRef = useRef(content);
  contentRef.current = content;

  // Init/reset on draft switch
  useEffect(() => {
    if (!activeDraft) return;
    // Always reset when draft id changes
    draftIdRef.current = activeDraft.id;
    setContent(activeDraft.content);
    setLastSaved(activeDraft.editedAt ?? null);

    // Clear any pending autosave from previous draft
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
  }, [activeDraft?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (autoSaveTimer.current) {
        clearTimeout(autoSaveTimer.current);
      }
    };
  }, []);

  const writeToFirestore = useCallback(async () => {
    const currentDraftId = draftIdRef.current;
    if (!currentDraftId || !user || !essayId) return;
    if (ownerUid) return; // viewer — cannot save
    if (!isLatestDraft) return;

    const currentContent = contentRef.current;
    if (!activeDraft || currentContent === activeDraft.content) return;

    setSaving(true);
    try {
      const draftRef = doc(db, `users/${user.uid}/essays/${essayId}/drafts/${currentDraftId}`);
      await updateDoc(draftRef, { content: currentContent, editedAt: serverTimestamp() });
      setLastSaved(new Date());
    } finally {
      setSaving(false);
    }
  }, [user, essayId, ownerUid, isLatestDraft, activeDraft]);

  const onChange = useCallback((newContent: string) => {
    setContent(newContent);
    // Clear existing timer
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
    }
    // Start 3-second debounced Firestore write
    autoSaveTimer.current = setTimeout(() => {
      writeToFirestore();
    }, 3000);
  }, [writeToFirestore]);

  const save = useCallback(async () => {
    // Clear pending autosave timer
    if (autoSaveTimer.current) {
      clearTimeout(autoSaveTimer.current);
      autoSaveTimer.current = null;
    }
    await writeToFirestore();
  }, [writeToFirestore]);

  const hasUnsavedEdits = content !== '' && content !== activeDraft?.content;

  return {
    content,
    onChange,
    save,
    saving,
    lastSaved,
    hasUnsavedEdits,
  };
}
