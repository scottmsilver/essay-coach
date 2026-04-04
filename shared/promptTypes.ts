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
