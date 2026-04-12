import { Badge, Group, Stack, Text, ActionIcon, Modal, Textarea, Button } from '@mantine/core';
import { IconPencil, IconFileImport } from '@tabler/icons-react';
import { useState } from 'react';
import type { CriteriaAnalysis, DocSource } from '../types';
import GDocImportDialog from './GDocImportDialog';
import { handleRichPaste } from '../utils/pasteHandler';
import AnalysisSummaryCard from './AnalysisSummaryCard';

interface CriteriaPanelProps {
  analysis: CriteriaAnalysis;
  teacherCriteria: string;
  criteriaSource: DocSource | null;
  isOwner: boolean;
  onSaveCriteria: (text: string, source: DocSource | null) => void;
  collapsible?: boolean;
}

const STATUS_COLORS: Record<string, string> = {
  met: 'var(--color-green)',
  partially_met: 'var(--color-yellow)',
  not_met: 'var(--color-red)',
};

const STATUS_BADGE_COLORS: Record<string, string> = {
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
  const partialCount = analysis.criteria.filter(c => c.status === 'partially_met').length;
  const notMetCount = analysis.criteria.filter(c => c.status === 'not_met').length;
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

  const segments = [
    { color: STATUS_COLORS.met, proportion: totalCount > 0 ? metCount / totalCount : 0, label: 'met', count: metCount },
    { color: STATUS_COLORS.partially_met, proportion: totalCount > 0 ? partialCount / totalCount : 0, label: 'partial', count: partialCount },
    { color: STATUS_COLORS.not_met, proportion: totalCount > 0 ? notMetCount / totalCount : 0, label: 'not met', count: notMetCount },
  ];

  return (
    <div className="criteria-view">
      {/* Summary card — matches grammar/transition/prompt/duplication pattern */}
      <div style={{ position: 'relative' }}>
        <AnalysisSummaryCard segments={segments} summaryText={analysis.overallNarrative}>
          {/* Comparison badges */}
          {analysis.comparisonToPrevious && (
            <div style={{ marginBottom: 8 }}>
              <Text size="xs" fw={500} mb={4}>{analysis.comparisonToPrevious.summary}</Text>
              <Group gap="xs" wrap="wrap">
                {analysis.comparisonToPrevious.improvements.map((imp, i) => (
                  <Badge key={`imp-${i}`} color="green" variant="light" size="xs">{imp.criterion}</Badge>
                ))}
                {analysis.comparisonToPrevious.regressions.map((reg, i) => (
                  <Badge key={`reg-${i}`} color="red" variant="light" size="xs">{reg.criterion}</Badge>
                ))}
              </Group>
            </div>
          )}
        </AnalysisSummaryCard>
        {/* Edit button floated top-right of card */}
        {isOwner && (
          <ActionIcon
            variant="subtle"
            size="sm"
            onClick={openEditModal}
            aria-label="Edit criteria"
            style={{ position: 'absolute', top: 16, right: 16 }}
          >
            <IconPencil size={16} />
          </ActionIcon>
        )}
      </div>

      {/* Collapsible criteria checklist */}
      <div
        className="criteria-checklist-header"
        onClick={collapsible ? () => setCollapsed(c => !c) : undefined}
        style={collapsible ? { cursor: 'pointer', userSelect: 'none' } : undefined}
      >
        {collapsible && (
          <span style={{
            fontSize: 11,
            color: 'var(--color-text-muted)',
            transition: 'transform 150ms',
            transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)',
            display: 'inline-block',
            marginRight: 6,
          }}>
            ▼
          </span>
        )}
        <Text size="xs" fw={600} c="dimmed" component="span" style={{ textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {totalCount} criteria
        </Text>
      </div>

      {!collapsed && (
        <div className="criteria-checklist">
          {analysis.criteria.map((cr, i) => (
            <div key={i} className="criteria-checklist-item">
              <Badge color={STATUS_BADGE_COLORS[cr.status]} variant="light" size="sm" style={{ flexShrink: 0 }}>
                {STATUS_LABELS[cr.status]}
              </Badge>
              <div>
                <Text size="sm" fw={500}>{cr.criterion}</Text>
                <Text size="xs" c="dimmed" mt={2}>{cr.comment}</Text>
              </div>
            </div>
          ))}
        </div>
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
                <Button variant="subtle" size="compact-xs" onClick={() => setGdocOpen(true)}>Change</Button>
                <Button variant="subtle" size="compact-xs" color="red" onClick={clearSource}>Clear</Button>
              </Group>
            ) : (
              <Button variant="light" size="compact-sm" leftSection={<IconFileImport size={14} />} onClick={() => setGdocOpen(true)}>
                Import from Google Docs
              </Button>
            )}
          </Group>
          <Textarea
            value={editText}
            onChange={(e) => { setEditText(e.currentTarget.value); if (editSource) setEditSource(null); }}
            onPaste={(e) => handleRichPaste(e, setEditText)}
            placeholder="Paste your teacher's rubric, checklist, or assignment requirements..."
            autosize
            minRows={6}
            maxRows={16}
            readOnly={!!editSource}
          />
          <Group justify="flex-end">
            <Button variant="subtle" onClick={() => setEditOpen(false)}>Cancel</Button>
            <Button onClick={handleSave}>Save &amp; Re-analyze</Button>
          </Group>
        </Stack>
        <GDocImportDialog opened={gdocOpen} onClose={() => setGdocOpen(false)} onImport={handleGDocImport} label="criteria" />
      </Modal>
    </div>
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
          <Button variant="light" onClick={() => setEditOpen(true)}>Add Criteria</Button>
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
            <GDocImportDialog opened={importOpen} onClose={() => setImportOpen(false)} onImport={handleImport} label="criteria" />
          </Modal>
        </>
      )}
    </Stack>
  );
}
