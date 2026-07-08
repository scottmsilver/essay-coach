import { Badge, Stack, Text } from '@mantine/core';
import type { ReasoningAnalysis, ReasoningClassification } from '../types';
import AnalysisSummaryCard from './AnalysisSummaryCard';

interface ReasoningPanelProps {
  analysis: ReasoningAnalysis;
}

const CLASSIFICATION_LABELS: Record<ReasoningClassification, string> = {
  sound: 'Sound',
  circular: 'Circular',
  not_applicable: 'Not applicable',
};

const CLASSIFICATION_BADGE_COLORS: Record<ReasoningClassification, string> = {
  sound: 'green',
  circular: 'red',
  not_applicable: 'gray',
};

const CLASSIFICATION_BAR_COLORS: Record<ReasoningClassification, string> = {
  sound: 'var(--color-green)',
  circular: 'var(--color-red)',
  not_applicable: 'var(--color-text-muted)',
};

export function ReasoningPanel({ analysis }: ReasoningPanelProps) {
  const { paragraphs, summary } = analysis;
  const total = summary.totalParagraphs;
  const argumentBearing = total - summary.notApplicable;

  let summaryText: string;
  if (summary.circular > 0) {
    summaryText = `${summary.circular} of ${argumentBearing} argument-bearing paragraphs may be circular. Review them below.`;
  } else if (summary.sound > 0) {
    summaryText = `Every argument-bearing paragraph offers substantive support. Total of ${total} paragraphs.`;
  } else {
    summaryText = `No argument-bearing paragraphs in this essay.`;
  }

  const denominator = total > 0 ? total : 1;
  const segments = [
    { color: CLASSIFICATION_BAR_COLORS.sound, proportion: summary.sound / denominator, label: 'sound', count: summary.sound },
    { color: CLASSIFICATION_BAR_COLORS.circular, proportion: summary.circular / denominator, label: 'circular', count: summary.circular },
    { color: CLASSIFICATION_BAR_COLORS.not_applicable, proportion: summary.notApplicable / denominator, label: 'not applicable', count: summary.notApplicable },
  ];

  const sortedParagraphs = [...paragraphs].sort((a, b) => a.index - b.index);

  return (
    <div className="reasoning-view">
      <AnalysisSummaryCard segments={segments} summaryText={summaryText} />

      <div className="analysis-summary">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em', marginBottom: 8 }}>
          Paragraphs
        </Text>
        {sortedParagraphs.length === 0 ? (
          <Text size="sm" c="dimmed">Need at least two paragraphs to assess reasoning.</Text>
        ) : (
          <Stack gap="sm">
            {sortedParagraphs.map((p) => (
              <div key={p.index} className="reasoning-paragraph-item">
                <div className="reasoning-paragraph-row">
                  <Badge color={CLASSIFICATION_BADGE_COLORS[p.classification]} variant="light" size="sm" style={{ flexShrink: 0 }}>
                    {CLASSIFICATION_LABELS[p.classification]}
                  </Badge>
                  <Text size="sm" fw={500}>Paragraph {p.index}</Text>
                </div>

                {p.classification !== 'not_applicable' && p.supportAddsAttempt && (
                  <Stack gap={4} mt={6}>
                    <ReasoningRow label="What the support adds:" value={p.supportAddsAttempt} />
                    {p.classification === 'circular' && p.claimEcho && (
                      <ReasoningRow label="Restated phrase:" value={p.claimEcho} />
                    )}
                  </Stack>
                )}

                <Text size="sm" mt={6}>{p.comment}</Text>
              </div>
            ))}
          </Stack>
        )}
      </div>
    </div>
  );
}

interface ReasoningRowProps {
  label: string;
  value: string;
}

function ReasoningRow({ label, value }: ReasoningRowProps) {
  return (
    <div className="reasoning-detail-row">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em', minWidth: 140, flexShrink: 0 }}>
        {label}
      </Text>
      <Text size="xs" fs="italic" c="dimmed">{value}</Text>
    </div>
  );
}

export function ReasoningEmptyState() {
  return (
    <Stack align="center" gap="md" py="xl">
      <Text size="sm" c="dimmed" ta="center">
        Need at least two paragraphs to assess reasoning.
      </Text>
    </Stack>
  );
}
