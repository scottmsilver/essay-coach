import type { Draft, CoachSynthesis } from '../types';

export type AnalysisKey = 'overall' | 'grammar' | 'transitions' | 'prompt' | 'duplication' | 'criteria';
export type AnalysisStatus = 'ready' | 'loading' | 'error' | 'pending';

export interface DraftEntity {
  id: string;
  raw: Draft;
  analysisStatus: (key: AnalysisKey) => AnalysisStatus;
  statusMessage: (key: AnalysisKey) => string | null;
  issueCount: (key: AnalysisKey) => number | undefined;
  coachReadiness: CoachSynthesis['readiness'] | null;
  coachNote: string | null;
  recommendedReport: AnalysisKey | null;
  contentEdited: boolean;
}

const DATA_FIELDS: Record<AnalysisKey, keyof Draft> = {
  overall: 'evaluation',
  grammar: 'grammarAnalysis',
  transitions: 'transitionAnalysis',
  prompt: 'promptAnalysis',
  duplication: 'duplicationAnalysis',
  criteria: 'criteriaAnalysis',
};

const STATUS_FIELDS: Record<AnalysisKey, keyof Draft> = {
  overall: 'evaluationStatus',
  grammar: 'grammarStatus',
  transitions: 'transitionStatus',
  prompt: 'promptStatus',
  duplication: 'duplicationStatus',
  criteria: 'criteriaStatus',
};

export function createDraftEntity(raw: Draft): DraftEntity {
  const analysisStatus = (key: AnalysisKey): AnalysisStatus => {
    if (raw[DATA_FIELDS[key]] != null) return 'ready';
    const status = raw[STATUS_FIELDS[key]] as Draft['evaluationStatus'];
    if (status != null) {
      return status.stage === 'error' ? 'error' : 'loading';
    }
    return 'pending';
  };

  const statusMessage = (key: AnalysisKey): string | null => {
    const status = raw[STATUS_FIELDS[key]] as Draft['evaluationStatus'];
    return status?.message ?? null;
  };

  const issueCount = (key: AnalysisKey): number | undefined => {
    switch (key) {
      case 'overall':
        return raw.evaluation
          ? Object.values(raw.evaluation.traits).filter((t) => t.revisionPriority !== null).length
          : undefined;
      case 'grammar':
        return raw.grammarAnalysis
          ? raw.grammarAnalysis.summary.totalErrors
          : undefined;
      case 'transitions':
        return raw.transitionAnalysis
          ? [...raw.transitionAnalysis.paragraphTransitions, ...raw.transitionAnalysis.sentenceTransitions]
              .filter((t) => t.quality === 'weak' || t.quality === 'missing').length
          : undefined;
      case 'prompt':
        return raw.promptAnalysis
          ? raw.promptAnalysis.summary.emptyCells + raw.promptAnalysis.summary.partialCells
          : undefined;
      case 'duplication':
        return raw.duplicationAnalysis
          ? raw.duplicationAnalysis.summary.totalDuplications
          : undefined;
      case 'criteria':
        return raw.criteriaAnalysis
          ? raw.criteriaAnalysis.criteria.filter((c) => c.status !== 'met').length
          : undefined;
    }
  };

  const synthesis = raw.coachSynthesis;
  const recommendedRaw = synthesis?.recommendedReport ?? null;
  // Map ReportKey to AnalysisKey — 'essay' has no analysis, so ignore it
  const recommendedReport: AnalysisKey | null =
    recommendedRaw != null && recommendedRaw !== 'essay'
      ? (recommendedRaw as AnalysisKey)
      : null;

  return {
    id: raw.id,
    raw,
    analysisStatus,
    statusMessage,
    issueCount,
    coachReadiness: synthesis?.readiness ?? null,
    coachNote: synthesis?.coachNote ?? null,
    recommendedReport,
    contentEdited: raw.editedAt != null && raw.editedAt > raw.submittedAt,
  };
}
