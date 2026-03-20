import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button, Group, Select, Text, TextInput, Textarea } from '@mantine/core';
import { functions, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { WRITING_TYPES, type WritingType, type DocSource } from '../types';
import { countWords } from '../utils';
import { handleRichPaste } from '../utils/pasteHandler';
import GDocImportDialog from '../components/GDocImportDialog';
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
  const [importTarget, setImportTarget] = useState<'prompt' | 'essay' | null>(null);
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

  const handlePickerImport = async (target: 'prompt' | 'essay') => {
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
      fireAllAnalyses(essayRef.id, draftRef.id);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit essay. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>New Essay</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <Select
          label="Writing Type"
          value={writingType}
          onChange={(val) => val && setWritingType(val as WritingType)}
          data={WRITING_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
          mb="md"
        />
        {/* Assignment Prompt */}
        <Group justify="space-between" mb={4}>
          <Text fw={500} size="sm">Assignment Prompt <span style={{ color: 'red' }}>*</span></Text>
          {promptSource ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Imported from Google Docs</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => handlePickerImport('prompt')}>Change</Button>
              <Button variant="subtle" size="compact-xs" color="red" onClick={clearPromptSource}>Clear</Button>
            </Group>
          ) : (
            <Button variant="subtle" size="compact-xs" onClick={() => handlePickerImport('prompt')}>
              Import from Google Docs
            </Button>
          )}
        </Group>
        <Textarea
          value={assignmentPrompt}
          onChange={(e) => {
            setAssignmentPrompt(e.currentTarget.value);
            if (promptSource) setPromptSource(null);
          }}
          maxLength={2000}
          required
          placeholder="Paste the assignment prompt here..."
          rows={3}
          description={`${assignmentPrompt.length}/2,000 characters`}
          mb="md"
          readOnly={!!promptSource}
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
        {/* Essay Content */}
        <Group justify="space-between" mb={4}>
          <Text fw={500} size="sm">Your Essay <span style={{ color: 'red' }}>*</span></Text>
          {contentSource ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Imported from Google Docs</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => handlePickerImport('essay')}>Change</Button>
              <Button variant="subtle" size="compact-xs" color="red" onClick={clearContentSource}>Clear</Button>
            </Group>
          ) : (
            <Button variant="subtle" size="compact-xs" onClick={() => handlePickerImport('essay')}>
              Import from Google Docs
            </Button>
          )}
        </Group>
        <Textarea
          value={content}
          onChange={(e) => {
            setContent(e.currentTarget.value);
            if (contentSource) setContentSource(null);
          }}
          onPaste={(e) => handleRichPaste(e, setContent)}
          required
          placeholder="Paste or type your essay here..."
          rows={16}
          description={`${wordCount.toLocaleString()} / 10,000 words`}
          error={wordCount > 10000 ? 'Essay exceeds 10,000 word limit' : undefined}
          mb="md"
          readOnly={!!contentSource}
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
        label={importTarget === 'prompt' ? 'prompt' : 'essay'}
        initialUrl={lastImportedUrl}
        initialDocName={lastImportedDocName}
      />
    </div>
  );
}
