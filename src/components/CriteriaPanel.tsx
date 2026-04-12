import { Badge, Group, Stack, Text, ActionIcon, Modal, Textarea, Button } from '@mantine/core';
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
  collapsible?: boolean;
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
  collapsible,
}: CriteriaPanelProps) {
  const [editOpen, setEditOpen] = useState(false);
  const [editText, setEditText] = useState('');
  const [editSource, setEditSource] = useState<DocSource | null>(null);
  const [gdocOpen, setGdocOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

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
    <Stack gap="sm" mb="md">
      {/* Header — clickable to collapse */}
      <Group
        justify="space-between"
        onClick={collapsible ? () => setCollapsed(c => !c) : undefined}
        style={collapsible ? { cursor: 'pointer', userSelect: 'none' } : undefined}
      >
        <Group gap="xs">
          {collapsible && (
            <span style={{ fontSize: 12, color: 'var(--color-text-muted)', transition: 'transform 150ms', transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)', display: 'inline-block' }}>
              ▼
            </span>
          )}
          <Text fw={600} size="sm">
            {metCount} of {totalCount} criteria met
          </Text>
        </Group>
        {isOwner && (
          <ActionIcon variant="subtle" size="sm" onClick={(e) => { e.stopPropagation(); openEditModal(); }} aria-label="Edit criteria">
            <IconPencil size={16} />
          </ActionIcon>
        )}
      </Group>

      {!collapsed && (
        <>
          {/* Overall narrative */}
          <Text size="sm" c="dimmed">{analysis.overallNarrative}</Text>

          {/* Comparison section */}
          {analysis.comparisonToPrevious && (
            <div>
              <Text size="sm" mb={4}>{analysis.comparisonToPrevious.summary}</Text>
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
            </div>
          )}

          {/* Criteria checklist — compact */}
          {analysis.criteria.map((cr, i) => (
            <Group key={i} gap="sm" wrap="nowrap" align="flex-start">
              <Badge color={STATUS_COLORS[cr.status]} variant="light" size="sm" style={{ flexShrink: 0, marginTop: 2 }}>
                {STATUS_LABELS[cr.status]}
              </Badge>
              <div>
                <Text size="sm" fw={500}>{cr.criterion}</Text>
                <Text size="xs" c="dimmed" mt={2}>{cr.comment}</Text>
              </div>
            </Group>
          ))}
        </>
      )}

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
