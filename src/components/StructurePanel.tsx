import { Badge, Stack, Text } from '@mantine/core';
import type { StructureAnalysis, ParagraphClassification } from '../types';
import AnalysisSummaryCard from './AnalysisSummaryCard';

interface StructurePanelProps {
  analysis: StructureAnalysis;
}

const CLASSIFICATION_LABELS: Record<ParagraphClassification, string> = {
  complete: 'Complete',
  missing_analysis: 'Missing analysis',
  missing_evidence: 'Missing evidence',
  missing_claim: 'Missing claim',
  off_pattern: 'Off pattern',
};

const CLASSIFICATION_BADGE_COLORS: Record<ParagraphClassification, string> = {
  complete: 'green',
  missing_analysis: 'red',
  missing_evidence: 'red',
  missing_claim: 'red',
  off_pattern: 'gray',
};

const CLASSIFICATION_BAR_COLORS: Record<ParagraphClassification, string> = {
  complete: 'var(--color-green)',
  missing_analysis: 'var(--color-red)',
  missing_evidence: 'var(--color-red)',
  missing_claim: 'var(--color-red)',
  off_pattern: 'var(--color-text-muted)',
};

export function StructurePanel({ analysis }: StructurePanelProps) {
  const { paragraphs, summary } = analysis;
  const total = summary.totalParagraphs;
  const ceaTotal = total - summary.offPattern;
  const issues = summary.missingAnalysis + summary.missingEvidence + summary.missingClaim;

  const summaryText = ceaTotal === 0
    ? `None of the ${total} paragraphs are trying to follow CEA structure.`
    : issues === 0
      ? `${summary.complete} of ${ceaTotal} paragraphs are doing CEA work. Nice — every paragraph that should follow CEA is doing it.`
      : `${summary.complete} of ${ceaTotal} paragraphs are doing CEA work. ${issues} need attention.`;

  const denominator = total > 0 ? total : 1;
  const segments = [
    { color: CLASSIFICATION_BAR_COLORS.complete, proportion: summary.complete / denominator, label: 'complete', count: summary.complete },
    { color: CLASSIFICATION_BAR_COLORS.missing_analysis, proportion: summary.missingAnalysis / denominator, label: 'missing analysis', count: summary.missingAnalysis },
    { color: CLASSIFICATION_BAR_COLORS.missing_evidence, proportion: summary.missingEvidence / denominator, label: 'missing evidence', count: summary.missingEvidence },
    { color: CLASSIFICATION_BAR_COLORS.missing_claim, proportion: summary.missingClaim / denominator, label: 'missing claim', count: summary.missingClaim },
    { color: CLASSIFICATION_BAR_COLORS.off_pattern, proportion: summary.offPattern / denominator, label: 'off pattern', count: summary.offPattern },
  ];

  const sortedParagraphs = [...paragraphs].sort((a, b) => a.index - b.index);

  return (
    <div className="structure-view">
      <AnalysisSummaryCard segments={segments} summaryText={summaryText} />

      {/* Paragraph cards */}
      <div className="analysis-summary">
        <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.08em', marginBottom: 8 }}>
          Paragraphs
        </Text>
        {sortedParagraphs.length === 0 ? (
          <Text size="sm" c="dimmed">Need at least two paragraphs to assess structure.</Text>
        ) : (
          <Stack gap="sm">
            {sortedParagraphs.map((p) => (
              <div key={p.index} className="structure-paragraph-item">
                <div className="structure-paragraph-row">
                  <Badge color={CLASSIFICATION_BADGE_COLORS[p.classification]} variant="light" size="sm" style={{ flexShrink: 0 }}>
                    {CLASSIFICATION_LABELS[p.classification]}
                  </Badge>
                  <Text size="sm" fw={500}>Paragraph {p.index}</Text>
                </div>

                {p.classification !== 'off_pattern' && (
                  <Stack gap={4} mt={6}>
                    <ComponentRow label="Claim" quotedText={p.claim.quotedText} />
                    <ComponentRow label="Evidence" quotedText={p.evidence.quotedText} />
                    <ComponentRow label="Analysis" quotedText={p.analysis.quotedText} />
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

interface ComponentRowProps {
  label: string;
  quotedText: string | null;
}

function ComponentRow({ label, quotedText }: ComponentRowProps) {
  return (
    <div className="structure-component-row">
      <Text size="xs" fw={600} c="dimmed" tt="uppercase" style={{ letterSpacing: '0.06em', minWidth: 72, flexShrink: 0 }}>
        {label}
      </Text>
      {quotedText ? (
        <Text size="xs" fs="italic" c="dimmed">&ldquo;{quotedText}&rdquo;</Text>
      ) : (
        <Text size="xs" c="dimmed">(missing)</Text>
      )}
    </div>
  );
}

export function StructureEmptyState() {
  return (
    <Stack align="center" gap="md" py="xl">
      <Text size="sm" c="dimmed" ta="center">
        Need at least two paragraphs to assess structure.
      </Text>
    </Stack>
  );
}
