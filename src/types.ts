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

// Grammar analysis types
export interface GrammarIssue {
  sentence: string;
  quotedText: string;
  comment: string;
  severity: 'error' | 'warning' | 'pattern';
}

export interface GrammarIssueCategory {
  locations: GrammarIssue[];
}

export interface GrammarAnalysis {
  commaSplices: GrammarIssueCategory;
  runOnSentences: GrammarIssueCategory;
  fragments: GrammarIssueCategory;
  subjectVerbAgreement: GrammarIssueCategory;
  pronounReference: GrammarIssueCategory;
  verbTenseConsistency: GrammarIssueCategory;
  parallelStructure: GrammarIssueCategory;
  punctuationErrors: GrammarIssueCategory;
  missingCommas: GrammarIssueCategory;
  sentenceVariety: {
    avgLength: number;
    distribution: {
      simple: number;
      compound: number;
      complex: number;
      compoundComplex: number;
    };
    comment: string;
  };
  activePassiveVoice: {
    activeCount: number;
    passiveCount: number;
    passiveInstances: { quotedText: string; comment: string }[];
  };
  modifierPlacement: {
    issues: { quotedText: string; comment: string }[];
  };
  wordiness: {
    instances: { quotedText: string; comment: string }[];
  };
  summary: {
    totalErrors: number;
    errorsByCategory: {
      commaSplices: number;
      runOnSentences: number;
      fragments: number;
      subjectVerbAgreement: number;
      pronounReference: number;
      verbTenseConsistency: number;
      parallelStructure: number;
      punctuationErrors: number;
      missingCommas: number;
    };
    overallComment: string;
    strengthAreas: string[];
    priorityFixes: string[];
  };
}

// Prompt adherence analysis types
export interface MatrixCell {
  status: 'filled' | 'partial' | 'empty';
  evidence: string[];
  comment: string;
}

export interface MatrixRow {
  label: string;
  cells: MatrixCell[];
}

export interface PromptMatrix {
  description: string;
  rowLabel: string;
  columnLabel: string;
  rows: MatrixRow[];
  columns: string[];
}

export interface PromptQuestion {
  questionText: string;
  addressed: boolean;
  evidence: string;
  comment: string;
}

export interface PromptAnalysis {
  matrix: PromptMatrix;
  questions: PromptQuestion[];
  summary: {
    totalCells: number;
    filledCells: number;
    partialCells: number;
    emptyCells: number;
    overallComment: string;
  };
}

export interface EvaluationStatus {
  stage: 'pending' | 'thinking' | 'generating' | 'error';
  message: string;
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
