import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { doc, collection, setDoc, serverTimestamp } from 'firebase/firestore';
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
    } catch (err: any) {
      setError(err.message || 'Failed to submit essay. Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <div>
      <h2>New Essay</h2>
      <form onSubmit={handleSubmit} style={{ marginTop: 20 }}>
        <div className="form-group">
          <label htmlFor="title">Title</label>
          <input id="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)}
            maxLength={200} required placeholder="e.g., Hamlet Analysis" />
        </div>
        <div className="form-group">
          <label htmlFor="writingType">Writing Type</label>
          <select id="writingType" value={writingType} onChange={(e) => setWritingType(e.target.value as WritingType)}>
            {WRITING_TYPES.map((t) => <option key={t} value={t}>{t.charAt(0).toUpperCase() + t.slice(1)}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label htmlFor="prompt">Assignment Prompt</label>
          <textarea id="prompt" value={assignmentPrompt} onChange={(e) => setAssignmentPrompt(e.target.value)}
            maxLength={2000} required placeholder="Paste the assignment prompt here..." rows={3} />
          <div style={{ fontSize: 12, color: 'var(--color-text-secondary)', marginTop: 4 }}>{assignmentPrompt.length}/2,000 characters</div>
        </div>
        <div className="form-group">
          <label htmlFor="essay">Your Essay</label>
          <textarea id="essay" value={content} onChange={(e) => setContent(e.target.value)}
            onPaste={(e) => handleRichPaste(e, setContent)}
            required placeholder="Paste or type your essay here..." rows={16} />
          <div style={{ fontSize: 12, color: wordCount > 10000 ? 'var(--color-red)' : 'var(--color-text-secondary)', marginTop: 4 }}>
            {wordCount.toLocaleString()} / 10,000 words
          </div>
        </div>
        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}
        <button type="submit" className="btn-primary" disabled={submitting || !title || !assignmentPrompt || !content || wordCount > 10000}>
          {submitting ? 'Submitting...' : 'Submit for Feedback'}
        </button>
      </form>
    </div>
  );
}
