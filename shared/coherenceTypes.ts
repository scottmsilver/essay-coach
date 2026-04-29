export type ParagraphRelation = 'supports' | 'contrasts_acknowledged' | 'contrasts_unacknowledged' | 'off_topic';

export interface ThesisParagraph {
  index: number;
  claim: string;
}

export interface ParagraphAssessment {
  index: number;
  relation: ParagraphRelation;
  quotedText: string;
  comment: string;
}

export interface CoherenceSummary {
  totalParagraphs: number;
  supports: number;
  contrastsAcknowledged: number;
  contrastsUnacknowledged: number;
  offTopic: number;
}

export interface CoherenceAnalysis {
  thesisParagraph: ThesisParagraph;
  paragraphs: ParagraphAssessment[];
  summary: CoherenceSummary;
}
