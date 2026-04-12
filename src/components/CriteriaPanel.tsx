import { Badge, Card, Group, Stack, Text, ActionIcon, Modal, Textarea, Button } from '@mantine/core';
import { IconPencil, IconFileImport } from '@tabler/icons-react';
import { useState } from 'react';
import type { CriteriaAnalysis, DocSource } from '../types';
import GDocImportDialog from './GDocImportDialog';
import { handleRichPaste } from '../utils/pasteHandler';

interface CriteriaPanelProps {
  analysis: CriteriaAnalysis;
  teacherCriteria: string;
  criteriaSource: DocSource | null;
  isOwner: boolean;
  onSaveCriteria: (text: string, source: DocSource | null) => void;
}

const STATUS_COLORS: Record<string, string> = {
  met: 'green',
  partially_met: 'yellow',
  not_met: 'red',
};

const STATUS_LABELS: Record<string, string> = {
  met: 'Met',
  partially_met: 'Partial',
  not_met: 'Not Met',
};

export function CriteriaPanel({
  analysis,
  teacherCriteria,
  criteriaSource,
  isOwner,
  onSaveCriteria,
}: CriteriaPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [editSource, setEditSource] = useState<DocSource | null>(null);
  const [gdocOpen, setGdocOpen] = useState(false);

  const metCount = analysis.criteria.filter(c => c.status === 'met').length;
  const totalCount = analysis.criteria.length;

  const openEditModal = () => {
    setEditText(teacherCriteria);
    setEditSource(criteriaSource);
    setEditOpen(true);
  };

  const handleSave = () => {
    onSaveCriteria(editText, editSource);
    setEditOpen(false);
  };

  const handleGDocImport = (text: string, source: DocSource) => {
    setEditText(text);
    setEditSource(source);
    setGdocOpen(false);
  };

  const clearSource = () => {
    setEditSource(null);
  };

  return (
    <Stack gap="md">
      {/* Header */}
      <Group justify="space-between">
        <Text fw={600} size="sm">
          {metCount} of {totalCount} criteria met
        </Text>
        {isOwner && (
          <ActionIcon variant="subtle" size="sm" onClick={openEditModal} aria-label="Edit criteria">
            <IconPencil size={16} />
          </ActionIcon>
        )}
      </Group>

      {/* Overall narrative */}
      <Card padding="sm" radius="sm" withBorder>
        <Text size="sm">{analysis.overallNarrative}</Text>
      </Card>

      {/* Comparison section */}
      {analysis.comparisonToPrevious && (
        <Card padding="sm" radius="sm" withBorder>
          <Text size="sm" fw={500} mb="xs">Comparison to Previous Draft</Text>
          <Text size="sm" mb="xs">{analysis.comparisonToPrevious.summary}</Text>
          <Group gap="xs" wrap="wrap">
            {analysis.comparisonToPrevious.improvements.map((imp, i) => (
              <Badge key={`imp-${i}`} color="green" variant="light" size="sm">
                {imp.criterion}
              </Badge>
            ))}
            {analysis.comparisonToPrevious.regressions.map((reg, i) => (
              <Badge key={`reg-${i}`} color="red" variant="light" size="sm">
                {reg.criterion}
              </Badge>
            ))}
          </Group>
        </Card>
      )}

      {/* Criteria checklist */}
      {analysis.criteria.map((cr, i) => (
        <Card key={i} padding="sm" radius="sm" withBorder>
          <Group justify="space-between" mb={4}>
            <Badge color={STATUS_COLORS[cr.status]} variant="light" size="sm">
              {STATUS_LABELS[cr.status]}
            </Badge>
            {cr.annotations.length > 0 && (
              <Badge variant="default" size="sm">
                {cr.annotations.length} annotation{cr.annotations.length !== 1 ? 's' : ''}
              </Badge>
            )}
          </Group>
          <Text size="sm" fw={600} mb={4}>{cr.criterion}</Text>
          <Text size="xs" c="dimmed" mb={4}>{cr.evidence}</Text>
          <Text size="sm">{cr.comment}</Text>
        </Card>
      ))}

      {/* Edit modal */}
      <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Edit Teacher Criteria" size="lg">
        <Stack gap="md">
          <Group justify="space-between">
            {editSource ? (
              <Group gap="xs">
                <Badge variant="light" size="sm" leftSection={<IconFileImport size={12} />}>
                  Imported from Google Docs
                </Badge>
                <Button variant="subtle" size="compact-xs" onClick={() => setGdocOpen(true)}>
                  Change
                </Button>
                <Button variant="subtle" size="compact-xs" color="red" onClick={clearSource}>
                  Clear
                </Button>
              </Group>
            ) : (
              <Button
                variant="light"
                size="compact-sm"
                leftSection={<IconFileImport size={14} />}
                onClick={() => setGdocOpen(true)}
              >
                Import from Google Docs
              </Button>
            )}
          </Group>

          <Textarea
            value={editText}
            onChange={(e) => {
              setEditText(e.currentTarget.value);
              if (editSource) setEditSource(null);
            }}
            onPaste={(e) => handleRichPaste(e, setEditText)}
            placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
            autosize
            minRows={6}
            maxRows={16}
            readOnly={!!editSource}
          />

          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave}>
              Save &amp; Re-analyze
            </Button>
          </Group>
        </Stack>

        <GDocImportDialog
          opened={gdocOpen}
          onClose={() => setGdocOpen(false)}
          onImport={handleGDocImport}
          label="criteria"
        />
      </Modal>
    </Stack>
  );
}

export function CriteriaEmptyState({ isOwner, onSaveCriteria }: { isOwner: boolean; onSaveCriteria: (text: string, source: DocSource | null) => void }) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [editSource, setEditSource] = useState<DocSource | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const handleSave = () => {
    onSaveCriteria(editText, editSource);
    setEditOpen(false);
  };

  const handleImport = (text: string, source: DocSource) => {
    setEditText(text);
    setEditSource(source);
    setImportOpen(false);
  };

  return (
    <Stack align="center" gap="md" py="xl">
      <Text size="sm" c="dimmed" ta="center">
        No teacher criteria provided. Add your teacher's rubric to see how your essay measures up.
      </Text>
      {isOwner && (
        <>
          <Button variant="light" onClick={() => setEditOpen(true)}>
            Add Criteria
          </Button>
          <Modal opened={editOpen} onClose={() => setEditOpen(false)} title="Add Teacher Criteria" size="lg">
            <Stack gap="md">
              <Group justify="flex-end">
                {editSource ? (
                  <Group gap="xs">
                    <Badge size="xs" variant="light">Imported from Google Docs</Badge>
                    <ActionIcon size="xs" variant="subtle" onClick={() => setImportOpen(true)}>
                      <IconPencil size={12} />
                    </ActionIcon>
                  </Group>
                ) : (
                  <Button variant="subtle" size="compact-xs" leftSection={<IconFileImport size={14} />} onClick={() => setImportOpen(true)}>
                    Import from Google Docs
                  </Button>
                )}
              </Group>
              <Textarea
                placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
                value={editText}
                onChange={(e) => setEditText(e.currentTarget.value)}
                onPaste={(e) => handleRichPaste(e, setEditText)}
                readOnly={!!editSource}
                autosize
                minRows={6}
                maxRows={15}
              />
              <Group justify="flex-end">
                <Button variant="subtle" onClick={() => setEditOpen(false)}>Cancel</Button>
                <Button onClick={handleSave} disabled={!editText.trim()}>Save & Analyze</Button>
              </Group>
            </Stack>
            <GDocImportDialog
              opened={importOpen}
              onClose={() => setImportOpen(false)}
              onImport={handleImport}
              label="criteria"
            />
          </Modal>
        </>
      )}
    </Stack>
  );
}
