import type { CoachSynthesis } from '../types';
import type { AnalysisKey, DraftEntity } from './draftEntity';

export type ReportStatus = 'unavailable' | 'loading' | 'ready' | 'error' | 'stale' | 'pending' | 'stale_content';

export interface ReportPresentation {
  status: ReportStatus;
  issueCount: number | undefined;
  isRecommended: boolean;
  statusMessage: string | null;
}

export type VerdictPhase = 'waiting' | 'analyzing' | 'error' | 'old_data' | 'has_verdict';

export interface VerdictPresentation {
  phase: VerdictPhase;
  coachReadiness: CoachSynthesis['readiness'] | null;
  coachNote: string | null;
  recommendedReport: AnalysisKey | null;
}

export interface DraftPresentation {
  reports: Record<AnalysisKey, ReportPresentation>;
  verdict: VerdictPresentation;
  canEdit: boolean;
  hasPrompt: boolean;
  isLatest: boolean;
}

const REPORT_KEYS: AnalysisKey[] = ['overall', 'grammar', 'transitions', 'prompt', 'duplication'];
const ONE_MINUTE = 60_000;
const THREE_MINUTES = 180_000;
const FIVE_MINUTES = 300_000;

function resolveReportStatus(
  entity: DraftEntity,
  key: AnalysisKey,
  draftAge: number,
  hasPrompt: boolean,
): ReportStatus {
  if (key === 'prompt' && !hasPrompt) return 'unavailable';

  const base = entity.analysisStatus(key);

  if (base === 'ready' && entity.contentEdited) return 'stale_content';
  if (base === 'ready') return 'ready';
  if (base === 'error') return 'error';
  if (base === 'loading') return 'loading';

  // base === 'pending'
  if (draftAge < ONE_MINUTE) return 'loading';
  if (draftAge >= THREE_MINUTES && key === 'overall') return 'stale';
  return 'pending';
}

function resolveVerdict(entity: DraftEntity, draftAge: number): VerdictPresentation {
  const synthesis = entity.raw.coachSynthesis;
  const synthesisStatus = entity.raw.coachSynthesisStatus;

  let phase: VerdictPhase;
  if (synthesis) {
    phase = 'has_verdict';
  } else if (synthesisStatus != null && synthesisStatus.stage === 'error') {
    phase = 'error';
  } else if (synthesisStatus != null) {
    phase = 'analyzing';
  } else if (draftAge > FIVE_MINUTES) {
    phase = 'old_data';
  } else {
    phase = 'waiting';
  }

  return {
    phase,
    coachReadiness: entity.coachReadiness,
    coachNote: entity.coachNote,
    recommendedReport: entity.recommendedReport,
  };
}

export function presentDraft(
  entity: DraftEntity,
  draftAge: number,
  hasPrompt: boolean,
  isLatest: boolean,
  _isOwner?: boolean,
): DraftPresentation {
  const reports = {} as Record<AnalysisKey, ReportPresentation>;

  for (const key of REPORT_KEYS) {
    reports[key] = {
      status: resolveReportStatus(entity, key, draftAge, hasPrompt),
      issueCount: entity.issueCount(key),
      isRecommended: entity.recommendedReport === key,
      statusMessage: entity.statusMessage(key),
    };
  }

  return {
    reports,
    verdict: resolveVerdict(entity, draftAge),
    canEdit: isLatest,
    hasPrompt,
    isLatest,
  };
}
