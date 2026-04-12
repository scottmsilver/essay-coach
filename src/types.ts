export const WRITING_TYPES = [
  'argumentative', 'narrative', 'expository',
  'persuasive', 'analytical', 'informational',
] as const;

export type WritingType = typeof WRITING_TYPES[number];

export const TRAIT_KEYS = [
  'ideas', 'organization', 'voice', 'wordChoice',
  'sentenceFluency', 'conventions', 'presentation',
] as const;

export type TraitKey = typeof TRAIT_KEYS[number];

export const TRAIT_LABELS: Record<TraitKey, string> = {
  ideas: 'Ideas',
  organization: 'Organization',
  voice: 'Voice',
  wordChoice: 'Word Choice',
  sentenceFluency: 'Sentence Fluency',
  conventions: 'Conventions',
  presentation: 'Presentation',
};

export interface Annotation {
  quotedText: string;
  comment: string;
}

export interface TraitAnnotation extends Annotation {
  traitKey: TraitKey;
  traitLabel: string;
}

export interface TraitEvaluation {
  score: number;
  feedback: string;
  revisionPriority: number | null;
  annotations: Annotation[];
}

export interface ScoreChange {
  previous: number;
  current: number;
  delta: number;
}

export interface Comparison {
  scoreChanges: Partial<Record<TraitKey, ScoreChange>>;
  improvements: string[];
  remainingIssues: string[];
}

export interface Evaluation {
  traits: Record<TraitKey, TraitEvaluation>;
  overallFeedback: string;
  revisionPlan: string[];
  comparisonToPrevious: Comparison | null;
}

import type { SentenceTransition, ParagraphTransition, TransitionAnalysis } from '../shared/transitionTypes';
export type { SentenceTransition, ParagraphTransition, TransitionAnalysis };

import type { DocSource } from '../shared/gdocTypes';
export type { DocSource };

// Grammar analysis types — canonical definitions in shared/grammarTypes.ts
import type { GrammarIssue, GrammarIssueCategory, GrammarAnalysis } from '../shared/grammarTypes';
export type { GrammarIssue, GrammarIssueCategory, GrammarAnalysis };

// Prompt adherence analysis types — canonical definitions in shared/promptTypes.ts
import type { MatrixCell, MatrixRow, PromptMatrix, PromptQuestion, PromptAnalysis } from '../shared/promptTypes';
export type { MatrixCell, MatrixRow, PromptMatrix, PromptQuestion, PromptAnalysis };

// Duplication analysis types — canonical definitions in shared/duplicationTypes.ts
import type { DuplicationInstance, DuplicationFinding, DuplicationAnalysis } from '../shared/duplicationTypes';
export type { DuplicationInstance, DuplicationFinding, DuplicationAnalysis };

// Criteria analysis types — canonical definitions in shared/criteriaTypes.ts
import type { CriterionResult, CriteriaAnalysis, CriteriaComparison } from '../shared/criteriaTypes';
export type { CriterionResult, CriteriaAnalysis, CriteriaComparison };

export interface EvaluationStatus {
  stage: 'pending' | 'thinking' | 'generating' | 'error';
  message: string;
}

// Coach synthesis types
export const REPORT_KEYS = ['essay', 'overall', 'grammar', 'transitions', 'prompt', 'duplication', 'criteria'] as const;
export type ReportKey = typeof REPORT_KEYS[number];

export const REPORT_LABELS: Record<ReportKey, string> = {
  essay: 'Essay',
  overall: 'Overall',
  grammar: 'Grammar',
  transitions: 'Transitions',
  prompt: 'Prompt Fit',
  duplication: 'Duplication',
  criteria: 'Criteria',
};

export interface ReportSummary {
  key: ReportKey;
  issueCount: number;
  label: string;
  detail: string;
  previousCount: number | null;
}

export interface CoachSynthesis {
  readiness: 'keep_going' | 'getting_close' | 'almost_there' | 'ready';
  coachNote: string;
  recommendedReport: ReportKey;
  reportSummaries: ReportSummary[];
  improvements: string[] | null;
}

export interface Draft {
  id: string;
  draftNumber: number;
  content: string;
  submittedAt: Date;
  evaluation: Evaluation | null;
  evaluationStatus?: EvaluationStatus | null;
  transitionAnalysis?: TransitionAnalysis | null;
  transitionStatus?: EvaluationStatus | null;
  grammarAnalysis?: GrammarAnalysis | null;
  grammarStatus?: EvaluationStatus | null;
  promptAnalysis?: PromptAnalysis | null;
  promptStatus?: EvaluationStatus | null;
  duplicationAnalysis?: DuplicationAnalysis | null;
  duplicationStatus?: EvaluationStatus | null;
  criteriaAnalysis?: CriteriaAnalysis | null;
  criteriaStatus?: EvaluationStatus | null;
  criteriaSnapshot?: string | null;
  coachSynthesis?: CoachSynthesis | null;
  coachSynthesisStatus?: EvaluationStatus | null;
  editedAt?: Date | null;
  lastScannedAt?: Date | null;
  revisionStage: number | null;
}

export interface Essay {
  id: string;
  title: string;
  assignmentPrompt: string;
  writingType: WritingType;
  createdAt: Date;
  updatedAt: Date;
  currentDraftNumber: number;
  promptSource?: DocSource | null;
  contentSource?: DocSource | null;
  teacherCriteria?: string | null;
  criteriaSource?: DocSource | null;
}

export interface Share {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  sharedWithUid: string;
  sharedWithEmail: string;
  createdAt: Date;
}

export interface EssayListItem extends Essay {
  ownerUid: string;
  ownerEmail: string;
}

export interface UserProfile {
  displayName: string;
  email: string;
  createdAt: Date;
}
