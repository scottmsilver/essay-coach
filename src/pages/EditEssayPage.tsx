import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { doc, updateDoc } from 'firebase/firestore';
import { Button, Select, TextInput } from '@mantine/core';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useEssay } from '../hooks/useEssay';
import { WRITING_TYPES, type WritingType, type DocSource } from '../types';
import ContentInput from '../components/ContentInput';
import GDocImportDialog from '../components/GDocImportDialog';
import { openGooglePicker } from '../utils/googlePicker';

export default function EditEssayPage() {
  const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essay, drafts, loading } = useEssay(essayId, ownerUid);

  // Form state
  const [title, setTitle] = useState('');
  const [writingType, setWritingType] = useState<WritingType>('argumentative');
  const [assignmentPrompt, setAssignmentPrompt] = useState('');
  const [promptSource, setPromptSource] = useState<DocSource | null>(null);
  const [teacherCriteria, setTeacherCriteria] = useState('');
  const [criteriaSource, setCriteriaSource] = useState<DocSource | null>(null);

  // GDoc import state
  const [importTarget, setImportTarget] = useState<'prompt' | 'criteria' | null>(null);
  const [lastImportedUrl, setLastImportedUrl] = useState('');
  const [lastImportedDocName, setLastImportedDocName] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Track whether we've initialized the form from the essay data
  const initialized = useRef(false);

  // Pre-fill form state once when essay loads
  useEffect(() => {
    if (essay && !initialized.current) {
      setTitle(essay.title);
      setWritingType(essay.writingType);
      setAssignmentPrompt(essay.assignmentPrompt);
      setPromptSource(essay.promptSource ?? null);
      setTeacherCriteria(essay.teacherCriteria ?? '');
      setCriteriaSource(essay.criteriaSource ?? null);
      initialized.current = true;
    }
  }, [essay]);

  const handleImport = (text: string, source: DocSource, url: string) => {
    setLastImportedUrl(url);
    if (importTarget === 'prompt') {
      setAssignmentPrompt(text);
      setPromptSource(source);
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

  const clearCriteriaSource = () => {
    setCriteriaSource(null);
    setTeacherCriteria('');
  };

  const handlePickerImport = async (target: 'prompt' | 'criteria') => {
    try {
      const purposeLabels = { prompt: 'assignment prompt', criteria: 'teacher criteria' };
      const result = await openGooglePicker(user?.email ?? undefined, purposeLabels[target]);
      if (!result) return;
      setLastImportedUrl(result.url);
      setLastImportedDocName(result.name);
      setImportTarget(target);
    } catch (err) {
      console.error('Picker failed:', err);
      setImportTarget(target);
    }
  };

  const basePath = ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`;

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!essayId || !user) return;
    setSaving(true);
    setError(null);

    try {
      const uid = ownerUid ?? user.uid;
      const essayRef = doc(db, 'users', uid, 'essays', essayId);

      const typeChanged = writingType !== essay?.writingType;
      const promptChanged = assignmentPrompt !== essay?.assignmentPrompt;
      const criteriaChanged = (teacherCriteria ?? '') !== (essay?.teacherCriteria ?? '');

      await updateDoc(essayRef, {
        title,
        writingType,
        assignmentPrompt,
        promptSource,
        teacherCriteria: teacherCriteria.trim() || null,
        criteriaSource,
      });

      // Clear stale analyses on the latest draft
      const latestDraft = drafts[0]; // drafts sorted by draftNumber desc
      if (latestDraft) {
        const draftDocRef = doc(db, 'users', uid, 'essays', essayId, 'drafts', latestDraft.id);
        const clears: Record<string, null> = {};
        if (typeChanged) { clears.evaluation = null; clears.evaluationStatus = null; }
        if (promptChanged) { clears.promptAnalysis = null; clears.promptStatus = null; }
        if (criteriaChanged) { clears.criteriaAnalysis = null; clears.criteriaStatus = null; clears.criteriaSnapshot = null; }
        if (Object.keys(clears).length > 0) {
          await updateDoc(draftDocRef, clears);
        }
      }

      navigate(`${basePath}/overall`);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save. Please try again.');
      setSaving(false);
    }
  };

  const handleCancel = () => {
    navigate(`${basePath}/overall`);
  };

  if (loading) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 0' }}>
        Loading...
      </div>
    );
  }

  if (!essay) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto', padding: '40px 0' }}>
        Essay not found.
      </div>
    );
  }

  return (
    <div style={{ maxWidth: 680, margin: '0 auto' }}>
      <h2>Edit Essay</h2>
      <form onSubmit={handleSave} style={{ marginTop: 20 }}>
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
          withCheckIcon={false}
          w="fit-content"
          styles={{ input: { minWidth: 160 } }}
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

        {error && <div className="error-state" style={{ marginBottom: 16 }}>{error}</div>}

        <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
          <Button type="submit" disabled={saving || !title || !assignmentPrompt} loading={saving}>
            Save Changes
          </Button>
          <Button variant="subtle" onClick={handleCancel} disabled={saving}>
            Cancel
          </Button>
        </div>
      </form>

      <GDocImportDialog
        opened={importTarget !== null}
        onClose={() => setImportTarget(null)}
        onImport={handleImport}
        label={importTarget === 'prompt' ? 'prompt' : 'criteria'}
        initialUrl={lastImportedUrl}
        initialDocName={lastImportedDocName}
      />
    </div>
  );
}
