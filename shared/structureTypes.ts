/** Feature flag: gates dispatch + sidebar everywhere it's checked.
 *  Flip to false to pause without removing code. */
export const STRUCTURE_ENABLED = true;

export type ParagraphClassification =
  | 'complete'
  | 'missing_analysis'
  | 'missing_evidence'
  | 'missing_claim'
  | 'off_pattern';

/** A CEA component (claim, evidence, or analysis) within a paragraph.
 *  quotedText is null when the component is missing. */
export interface ParagraphComponent {
  quotedText: string | null;
}

export interface ParagraphStructure {
  index: number;
  classification: ParagraphClassification;
  claim: ParagraphComponent;
  evidence: ParagraphComponent;
  analysis: ParagraphComponent;
  comment: string;
}

export interface StructureSummary {
  totalParagraphs: number;
  complete: number;
  missingAnalysis: number;
  missingEvidence: number;
  missingClaim: number;
  offPattern: number;
}

export interface StructureAnalysis {
  paragraphs: ParagraphStructure[];
  summary: StructureSummary;
}
