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

export interface SentenceTransition {
  paragraph: number;
  fromSentence: number;
  toSentence: number;
  quality: 'smooth' | 'adequate' | 'weak' | 'missing';
  comment: string;
}

export interface ParagraphTransition {
  fromParagraph: number;
  toParagraph: number;
  quality: 'smooth' | 'adequate' | 'weak' | 'missing';
  comment: string;
}

export interface TransitionAnalysis {
  sentenceTransitions: SentenceTransition[];
  paragraphTransitions: ParagraphTransition[];
  summary: string;
}

export interface EvaluationStatus {
  stage: 'thinking' | 'generating' | 'error';
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
}

export interface UserProfile {
  displayName: string;
  email: string;
  createdAt: Date;
}
