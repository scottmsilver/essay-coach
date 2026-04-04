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
