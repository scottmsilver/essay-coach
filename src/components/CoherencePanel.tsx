import { Badge, Stack, Text } from '@mantine/core';
import type { CoherenceAnalysis, ParagraphRelation } from '../types';
import AnalysisSummaryCard from './AnalysisSummaryCard';

interface CoherencePanelProps {
  analysis: CoherenceAnalysis;
}

const RELATION_LABELS: Record<ParagraphRelation, string> = {
  supports: 'Supports',
  contrasts_acknowledged: 'Counterargument',
  contrasts_unacknowledged: 'Contradicts',
  off_topic: 'Off topic',
};

const RELATION_BADGE_COLORS: Record<ParagraphRelation, string> = {
  supports: 'green',
  contrasts_acknowledged: 'yellow',
  contrasts_unacknowledged: 'red',
  off_topic: 'red',
};

const RELATION_BAR_COLORS: Record<ParagraphRelation, string> = {
  supports: 'var(--color-green)',
  contrasts_acknowledged: 'var(--color-accent)',
  contrasts_unacknowledged: 'var(--color-red)',
  off_topic: 'var(--color-red)',
};

export function CoherencePanel({ analysis }: CoherencePanelProps) {
  const { thesisParagraph, paragraphs, summary } = analysis;
  const total = summary.totalParagraphs;
  const issues = summary.contrastsUnacknowledged + summary.offTopic;

  const summaryText = issues === 0
    ? `Every paragraph either supports the thesis or signals its counterargument. Total of ${total} paragraphs.`
    : `${issues} of ${total} paragraphs may be working against the thesis. Review them below.`;

  const segments = [
    { color: RELATION_BAR_COLORS.supports, proportion: total > 0 ? summary.supports / total : 0, label: 'supports', count: summary.supports },
    { color: RELATION_BAR_COLORS.contrasts_acknowledged, proportion: total > 0 ? summary.contrastsAcknowledged / total : 0, label: 'counterargument', count: summary.contrastsAcknowledged },
    { color: RELATION_BAR_COLORS.contrasts_unacknowledged, proportion: total > 0 ? summary.contrastsUnacknowledged / total : 0, label: 'contradicts', count: summary.contrastsUnacknowledged },
    { color: RELATION_BAR_COLORS.off_topic, proportion: total > 0 ? summary.offTopic / total : 0, label: 'off topic', count: summary.offTopic },
  ];

  const sortedParagraphs = [...paragraphs].sort((a, b) => a.index - b.index);

  return (
    <div className="coherence-view">
      <AnalysisSummaryCard segments={segments} summaryText={summaryText} />

      {/* Thesis card */}
      <div className="analysis-summary">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em', marginBottom: 6 }}>
          Thesis (paragraph {thesisParagraph.index})
        </Text>
        <Text size="sm">{thesisParagraph.claim}</Text>
      </div>

      {/* Paragraph assessments */}
      <div className="analysis-summary">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em', marginBottom: 8 }}>
          Paragraphs
        </Text>
        {sortedParagraphs.length === 0 ? (
          <Text size="sm" c="dimmed">Need at least two paragraphs to assess coherence.</Text>
        ) : (
          <Stack gap="sm">
            {sortedParagraphs.map((p) => (
              <div key={p.index} className="coherence-paragraph-item">
                <div className="coherence-paragraph-row">
                  <Badge color={RELATION_BADGE_COLORS[p.relation]} variant="light" size="sm" style={{ flexShrink: 0 }}>
                    {RELATION_LABELS[p.relation]}
                  </Badge>
                  <Text size="sm" fw={500}>Paragraph {p.index}</Text>
                </div>
                {p.quotedText && (
                  <Text size="xs" c="dimmed" mt={4} fs="italic">&ldquo;{p.quotedText}&rdquo;</Text>
                )}
                <Text size="sm" mt={4}>{p.comment}</Text>
              </div>
            ))}
          </Stack>
        )}
      </div>
    </div>
  );
}

export function CoherenceEmptyState() {
  return (
    <Stack align="center" gap="md" py="xl">
      <Text size="sm" c="dimmed" ta="center">
        Need at least two paragraphs to assess coherence.
      </Text>
    </Stack>
  );
}
