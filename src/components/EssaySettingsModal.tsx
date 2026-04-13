import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Modal, Stack, Group, Button, TextInput, Select, Text } from '@mantine/core';
import ContentInput from './ContentInput';
import GDocImportDialog from './GDocImportDialog';
import { openGooglePicker } from '../utils/googlePicker';
import { useAuth } from '../hooks/useAuth';
import { WRITING_TYPES, type Essay, type WritingType, type DocSource } from '../types';

export interface EssaySettingsUpdate {
  title: string;
  writingType: WritingType;
  assignmentPrompt: string;
  promptSource: DocSource | null;
  teacherCriteria: string;
  criteriaSource: DocSource | null;
}

interface EssaySettingsModalProps {
  opened: boolean;
  onClose: () => void;
  essay: Essay;
  essayId: string;
  ownerUid?: string;
  onSave: (update: EssaySettingsUpdate) => void;
  editPageUrl: string;
}

export default function EssaySettingsModal({
  opened,
  onClose,
  essay,
  essayId: _essayId,
  ownerUid: _ownerUid,
  onSave,
  editPageUrl,
}: EssaySettingsModalProps) {
  const { user } = useAuth();

  // Form state
  const [title, setTitle] = useState(essay.title);
  const [writingType, setWritingType] = useState<WritingType>(essay.writingType);
  const [assignmentPrompt, setAssignmentPrompt] = useState(essay.assignmentPrompt);
  const [promptSource, setPromptSource] = useState<DocSource | null>(essay.promptSource ?? null);
  const [teacherCriteria, setTeacherCriteria] = useState(essay.teacherCriteria ?? '');
  const [criteriaSource, setCriteriaSource] = useState<DocSource | null>(essay.criteriaSource ?? null);

  // GDoc import state
  const [importTarget, setImportTarget] = useState<'prompt' | 'criteria' | null>(null);
  const [lastImportedUrl, setLastImportedUrl] = useState('');
  const [lastImportedDocName, setLastImportedDocName] = useState('');

  // Re-sync form state when modal opens or essay changes
  useEffect(() => {
    if (opened) {
      setTitle(essay.title);
      setWritingType(essay.writingType);
      setAssignmentPrompt(essay.assignmentPrompt);
      setPromptSource(essay.promptSource ?? null);
      setTeacherCriteria(essay.teacherCriteria ?? '');
      setCriteriaSource(essay.criteriaSource ?? null);
    }
  }, [opened, essay]);

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

  const handleSave = () => {
    onSave({
      title,
      writingType,
      assignmentPrompt,
      promptSource,
      teacherCriteria,
      criteriaSource,
    });
  };

  return (
    <>
      <Modal opened={opened} onClose={onClose} title="Essay Settings" size="lg">
        <Stack>
          <TextInput
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.currentTarget.value)}
            maxLength={200}
            required
            placeholder="e.g., Hamlet Analysis"
          />

          <Select
            label="Writing Type"
            value={writingType}
            onChange={(val) => val && setWritingType(val as WritingType)}
            data={WRITING_TYPES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
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

          <Group justify="space-between" mt="md">
            <Text
              component={Link}
              to={editPageUrl}
              size="sm"
              c="dimmed"
              td="underline"
              onClick={onClose}
            >
              Open full editor
            </Text>
            <Group>
              <Button variant="subtle" onClick={onClose}>
                Cancel
              </Button>
              <Button onClick={handleSave} disabled={!title || !assignmentPrompt}>
                Save Changes
              </Button>
            </Group>
          </Group>
        </Stack>
      </Modal>

      <GDocImportDialog
        opened={importTarget !== null}
        onClose={() => setImportTarget(null)}
        onImport={handleImport}
        label={importTarget === 'prompt' ? 'prompt' : 'criteria'}
        initialUrl={lastImportedUrl}
        initialDocName={lastImportedDocName}
      />
    </>
  );
}
