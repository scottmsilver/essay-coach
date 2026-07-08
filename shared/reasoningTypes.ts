/** Feature flag: gates dispatch + sidebar everywhere it's checked.
 *  Flip to false to pause without removing code. */
export const REASONING_ENABLED = false;

export type ReasoningClassification = 'sound' | 'circular' | 'not_applicable';

export interface ParagraphReasoning {
  index: number;
  /** Stable id echoed back by the model (e.g. "p1"). Optional for backward
   *  compatibility with analyses persisted before ids were introduced. */
  id?: string;
  classification: ReasoningClassification;
  /** Gemini's attempt at completing "The support adds the new information that ___."
   *  Set on every classification except not_applicable (which has no argument). */
  supportAddsAttempt: string | null;
  /** The 5-15 word phrase from the support that's just restating the claim.
   *  Only set when classification is 'circular'. */
  claimEcho: string | null;
  comment: string;
}

export interface ReasoningSummary {
  totalParagraphs: number;
  sound: number;
  circular: number;
  notApplicable: number;
}

export interface ReasoningAnalysis {
  paragraphs: ParagraphReasoning[];
  summary: ReasoningSummary;
}
