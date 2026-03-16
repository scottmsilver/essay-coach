import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
import { Button, Select, TextInput, Textarea } from '@mantine/core';
import { functions, db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { WRITING_TYPES, type WritingType } from '../types';
import { countWords } from '../utils';
import { handleRichPaste } from '../utils/pasteHandler';

export default function NewEssayPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = countWords(content);

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
        <Textarea
          label="Assignment Prompt"
          value={assignmentPrompt}
          onChange={(e) => setAssignmentPrompt(e.currentTarget.value)}
          maxLength={2000}
          required
          placeholder="Paste the assignment prompt here..."
          rows={3}
          description={`${assignmentPrompt.length}/2,000 characters`}
          mb="md"
        />
        <Textarea
          label="Your Essay"
          value={content}
          onChange={(e) => setContent(e.currentTarget.value)}
          onPaste={(e) => handleRichPaste(e, setContent)}
          required
          placeholder="Paste or type your essay here..."
          rows={16}
          description={`${wordCount.toLocaleString()} / 10,000 words`}
          error={wordCount > 10000 ? 'Essay exceeds 10,000 word limit' : undefined}
          mb="md"
        />
        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}
        <Button type="submit" disabled={submitting || !title || !assignmentPrompt || !content || wordCount > 10000} loading={submitting}>
          Submit for Feedback
        </Button>
      </form>
    </div>
  );
}
