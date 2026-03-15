import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { WRITING_TYPES, type WritingType } from '../types';
import { countWords } from '../utils';

export default function NewEssayPage() {
  const navigate = useNavigate();
  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [content, setContent] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const wordCount = countWords(content);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const submitEssay = httpsCallable(functions, 'submitEssay', { timeout: 180000 });
      const result = await submitEssay({ title, assignmentPrompt, writingType, content });
      const { essayId } = result.data as { essayId: string };
      navigate(`/essay/${essayId}`);
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
            required placeholder="Paste or type your essay here..." rows={16} />
          <div style={{ fontSize: 12, color: wordCount > 10000 ? 'var(--color-red)' : 'var(--color-text-secondary)', marginTop: 4 }}>
            {wordCount.toLocaleString()} / 10,000 words
          </div>
        </div>
        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}
        {submitting ? (
          <div className="loading-state"><div className="spinner" /><p>Evaluating your essay... This may take 10-30 seconds.</p></div>
        ) : (
          <button type="submit" className="btn-primary" disabled={!title || !assignmentPrompt || !content || wordCount > 10000}>
            Submit for Feedback
          </button>
        )}
      </form>
    </div>
  );
}
