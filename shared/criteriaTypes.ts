export interface CriterionAnnotation {
  quotedText: string;
  comment: string;
}

export interface CriterionResult {
  criterion: string;
  status: 'met' | 'partially_met' | 'not_met';
  evidence: string;
  comment: string;
  annotations: CriterionAnnotation[];
}

export interface CriteriaComparison {
  improvements: Array<{ criterion: string; previous: 'met' | 'partially_met' | 'not_met'; current: 'met' | 'partially_met' | 'not_met' }>;
  regressions: Array<{ criterion: string; previous: 'met' | 'partially_met' | 'not_met'; current: 'met' | 'partially_met' | 'not_met' }>;
  unchanged: Array<{ criterion: string; status: 'met' | 'partially_met' | 'not_met' }>;
  newCriteria: string[];
  removedCriteria: string[];
  summary: string;
}

export interface CriteriaAnalysis {
  criteria: CriterionResult[];
  overallNarrative: string;
  comparisonToPrevious: CriteriaComparison | null;
}
