import { useState } from 'react';
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

  const wordCount = countWords(content);

  const handleImport = (text: string, source: DocSource) => {
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
        }),
      ]);

      // Navigate immediately — EssayPage will show the progress UI
      navigate(`/essay/${essayRef.id}`);

      // Trigger evaluation in background (fire-and-forget)
      const evaluateEssay = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
      evaluateEssay({ essayId: essayRef.id, draftId: draftRef.id }).catch((err) => {
        console.error('Background evaluation failed:', err);
      });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit essay. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>New Essay</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <TextInput
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.currentTarget.value)}
          maxLength={200}
          required
          placeholder="e.g., Hamlet Analysis"
          mb="md"
        />
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
              <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('prompt')}>Change</Button>
              <Button variant="subtle" size="compact-xs" color="red" onClick={clearPromptSource}>Clear</Button>
            </Group>
          ) : (
            <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('prompt')}>
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
        {/* Essay Content */}
        <Group justify="space-between" mb={4}>
          <Text fw={500} size="sm">Your Essay <span style={{ color: 'red' }}>*</span></Text>
          {contentSource ? (
            <Group gap="xs">
              <Text size="xs" c="dimmed">Imported from Google Docs</Text>
              <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('essay')}>Change</Button>
              <Button variant="subtle" size="compact-xs" color="red" onClick={clearContentSource}>Clear</Button>
            </Group>
          ) : (
            <Button variant="subtle" size="compact-xs" onClick={() => setImportTarget('essay')}>
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
      />
    </div>
  );
}
