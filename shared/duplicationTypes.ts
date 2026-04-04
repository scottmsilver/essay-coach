export interface DuplicationInstance {
  quotedText: string;
  paragraph: number;
  recommendation: 'keep' | 'cut';
}

export interface DuplicationFinding {
  idea: string;
  severity: 'high' | 'medium';
  instances: DuplicationInstance[];
  comment: string;
}

export interface DuplicationAnalysis {
  findings: DuplicationFinding[];
  summary: {
    totalDuplications: number;
    uniqueIdeas: number;
    overallComment: string;
  };
}
