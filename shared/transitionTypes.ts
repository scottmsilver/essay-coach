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
  /** Paragraph index (as string key) → array of sentences. Map format for Firestore compatibility (no nested arrays). */
  sentences?: Record<string, string[]>;
}
