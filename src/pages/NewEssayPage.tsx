import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button, Select, Text, TextInput } from '@mantine/core';
import { functions, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { WRITING_TYPES, type WritingType, type DocSource } from '../types';
import { countWords } from '../utils';
import GDocImportDialog from '../components/GDocImportDialog';
import ContentInput from '../components/ContentInput';
import { fireAllAnalyses } from '../utils/submitEssay';
import { openGooglePicker } from '../utils/googlePicker';

export default function NewEssayPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [promptSource, setPromptSource] = useState<DocSource | null>(null);
  const [contentSource, setContentSource] = useState<DocSource | null>(null);
  const [teacherCriteria, setTeacherCriteria] = useState('');
  const [criteriaSource, setCriteriaSource] = useState<DocSource | null>(null);
  const [importTarget, setImportTarget] = useState<'prompt' | 'essay' | 'criteria' | null>(null);
  const [lastImportedUrl, setLastImportedUrl] = useState('');
  const [lastImportedDocName, setLastImportedDocName] = useState('');
  const [titleIsGenerated, setTitleIsGenerated] = useState(false);
  const [titleSuggesting, setTitleSuggesting] = useState(false);
  const titleDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const wordCount = countWords(content);

  const handleImport = (text: string, source: DocSource, url: string) => {
    setLastImportedUrl(url);
    if (importTarget === 'prompt') {
      setAssignmentPrompt(text);
      setPromptSource(source);
    } else if (importTarget === 'essay') {
      setContent(text);
      setContentSource(source);
    } else if (importTarget === 'criteria') {
      setTeacherCriteria(text);
      setCriteriaSource(source);
    }
    setImportTarget(null);
  };

  const clearPromptSource = () => {
    setPromptSource(null);
    setAssignmentPrompt('');
  };

  const clearContentSource = () => {
    setContentSource(null);
    setContent('');
  };

  const clearCriteriaSource = () => {
    setCriteriaSource(null);
    setTeacherCriteria('');
  };

  const handlePickerImport = async (target: 'prompt' | 'essay' | 'criteria') => {
    try {
      const result = await openGooglePicker(user?.email ?? undefined);
      if (!result) return; // user cancelled
      // Open the dialog with the URL pre-filled — it will auto-fetch
      setLastImportedUrl(result.url);
      setLastImportedDocName(result.name);
      setImportTarget(target);
    } catch (err) {
      console.error('Picker failed:', err);
      // Fall back to dialog without pre-fill
      setImportTarget(target);
    }
  };

  // Auto-suggest title when assignment prompt changes
  const titleIsGeneratedRef = useRef(false);
  const titleRef = useRef('');
  titleIsGeneratedRef.current = titleIsGenerated;
  titleRef.current = title;

  const suggestTitleFromPrompt = useCallback(async (promptText: string) => {
    if (promptText.trim().length < 10) return;
    // Don't overwrite a manually-typed title
    if (!titleIsGeneratedRef.current && titleRef.current) return;
    setTitleSuggesting(true);
    try {
      const suggest = httpsCallable<{ prompt: string }, { title: string }>(functions, 'suggestTitle', { timeout: 30000 });
      const result = await suggest({ prompt: promptText });
      if (result.data.title) {
        setTitle(result.data.title);
        setTitleIsGenerated(true);
      }
    } catch {
      // Silent fail — student can type manually
    } finally {
      setTitleSuggesting(false);
    }
  }, []);

  useEffect(() => {
    if (!assignmentPrompt) return;
    clearTimeout(titleDebounceRef.current);
    titleDebounceRef.current = setTimeout(() => {
      suggestTitleFromPrompt(assignmentPrompt);
    }, 1000);
    return () => clearTimeout(titleDebounceRef.current);
  }, [assignmentPrompt, suggestTitleFromPrompt]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setSubmitting(true);
    setError(null);
    try {
      // Create essay + draft docs directly so we can navigate immediately
      const essayRef = doc(collection(db, `users/${user.uid}/essays`));
      const draftRef = doc(collection(db, `users/${user.uid}/essays/${essayRef.id}/drafts`));

      await Promise.all([
        setDoc(essayRef, {
          title,
          assignmentPrompt,
          writingType,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
          currentDraftNumber: 1,
          teacherCriteria: teacherCriteria.trim() || null,
          criteriaSource: criteriaSource,
          ...(promptSource && { promptSource }),
          ...(contentSource && { contentSource }),
        }),
        setDoc(draftRef, {
          draftNumber: 1,
          content,
          submittedAt: serverTimestamp(),
          grammarStatus: { stage: 'pending', message: 'Queued...' },
          transitionStatus: { stage: 'pending', message: 'Queued...' },
        }),
      ]);

      // Navigate immediately — EssayPage will show the progress UI
      navigate(`/essay/${essayRef.id}`);

      // Fire all 3 analyses in parallel (fire-and-forget)
      fireAllAnalyses(essayRef.id, draftRef.id, undefined, teacherCriteria);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit essay. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h2>New Essay</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <Select
          label="Writing Type"
          value={writingType}
          onChange={(val) => val && setWritingType(val as WritingType)}
          data={WRITING_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
          mb="md"
        />
        <ContentInput
          label="Assignment Prompt"
          required
          value={assignmentPrompt}
          onChange={(v) => { setAssignmentPrompt(v); if (promptSource) setPromptSource(null); }}
          imported={!!promptSource}
          onImportClick={() => handlePickerImport('prompt')}
          onClear={clearPromptSource}
          placeholder="Paste the assignment prompt here..."

          maxLength={10000}
          minRows={3}
          maxRows={8}
        />
        <ContentInput
          label="Teacher Criteria"
          optional
          value={teacherCriteria}
          onChange={(v) => { setTeacherCriteria(v); if (criteriaSource) setCriteriaSource(null); }}
          imported={!!criteriaSource}
          onImportClick={() => handlePickerImport('criteria')}
          onClear={clearCriteriaSource}
          placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."

          minRows={3}
          maxRows={8}
        />
        <div style={{ position: 'relative' }}>
          <TextInput
            label="Title"
            value={title}
            onChange={(e) => {
              setTitle(e.currentTarget.value);
              setTitleIsGenerated(false);
            }}
            maxLength={200}
            required
            placeholder="e.g., Hamlet Analysis"
            mb="md"
            rightSection={titleSuggesting ? <div className="spinner" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} /> : undefined}
          />
          {titleIsGenerated && title && (
            <Text size="xs" c="dimmed" style={{ position: 'absolute', right: 0, top: 0 }}>AI-suggested</Text>
          )}
        </div>
        <ContentInput
          label="Your Essay"
          required
          value={content}
          onChange={(v) => { setContent(v); if (contentSource) setContentSource(null); }}
          imported={!!contentSource}
          onImportClick={() => handlePickerImport('essay')}
          onClear={clearContentSource}
          placeholder="Paste or type your essay here..."

          minRows={8}
          maxRows={20}
          showWordCount
          wordLimit={10000}
        />
        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}
        <Button type="submit" disabled={submitting || !title || !assignmentPrompt || !content || wordCount > 10000} loading={submitting}>
          Submit for Feedback
        </Button>
      </form>
      <GDocImportDialog
        opened={importTarget !== null}
        onClose={() => setImportTarget(null)}
        onImport={handleImport}
        label={importTarget === 'prompt' ? 'prompt' : importTarget === 'criteria' ? 'criteria' : 'essay'}
        initialUrl={lastImportedUrl}
        initialDocName={lastImportedDocName}
      />
    </div>
  );
}
