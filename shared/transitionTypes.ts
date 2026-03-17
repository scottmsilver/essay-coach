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
  sentences?: string[][];
}
