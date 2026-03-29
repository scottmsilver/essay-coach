import { describe, it, expect } from 'vitest';
import { createDraftEntity } from './draftEntity';
import type { Draft, Evaluation, TraitEvaluation, GrammarAnalysis, TransitionAnalysis, PromptAnalysis, CoachSynthesis } from '../types';

// --- Helpers ---

function makeDraft(overrides: Partial<Draft> = {}): Draft {
  return {
    id: 'draft-1',
    draftNumber: 1,
    content: 'Test essay content.',
    submittedAt: new Date('2026-03-28T12:00:00Z'),
    evaluation: null,
    revisionStage: null,
    ...overrides,
  };
}

function makeTrait(overrides: Partial<TraitEvaluation> = {}): TraitEvaluation {
  return {
    score: 4,
    feedback: 'Good work.',
    revisionPriority: null,
    annotations: [],
    ...overrides,
  };
}

function makeEvaluation(priorityTraits: string[] = []): Evaluation {
  const traitKeys = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'] as const;
  const traits = {} as Record<typeof traitKeys[number], TraitEvaluation>;
  for (const key of traitKeys) {
    traits[key] = makeTrait({
      revisionPriority: priorityTraits.includes(key) ? 1 : null,
    });
  }
  return {
    traits,
    overallFeedback: 'Nice essay.',
    revisionPlan: [],
    comparisonToPrevious: null,
  };
}

function makeGrammarAnalysis(totalErrors: number): GrammarAnalysis {
  const emptyCategory = { locations: [] };
  return {
    commaSplices: emptyCategory,
    runOnSentences: emptyCategory,
    fragments: emptyCategory,
    subjectVerbAgreement: emptyCategory,
    pronounReference: emptyCategory,
    verbTenseConsistency: emptyCategory,
    parallelStructure: emptyCategory,
    punctuationErrors: emptyCategory,
    missingCommas: emptyCategory,
    sentenceVariety: { avgLength: 15, distribution: { simple: 5, compound: 3, complex: 2, compoundComplex: 1 }, comment: '' },
    activePassiveVoice: { activeCount: 8, passiveCount: 2, passiveInstances: [] },
    modifierPlacement: { issues: [] },
    wordiness: { instances: [] },
    summary: {
      totalErrors,
      errorsByCategory: {
        commaSplices: 0, runOnSentences: 0, fragments: 0,
        subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0,
        parallelStructure: 0, punctuationErrors: 0, missingCommas: 0,
      },
      overallComment: '',
      strengthAreas: [],
      priorityFixes: [],
    },
  };
}

function makeTransitionAnalysis(weakCount: number, missingCount: number): TransitionAnalysis {
  const transitions: TransitionAnalysis = {
    sentenceTransitions: [],
    paragraphTransitions: [],
    summary: 'Summary.',
  };
  for (let i = 0; i < weakCount; i++) {
    transitions.sentenceTransitions.push({
      paragraph: 1, fromSentence: i, toSentence: i + 1,
      quality: 'weak', comment: '',
    });
  }
  for (let i = 0; i < missingCount; i++) {
    transitions.paragraphTransitions.push({
      fromParagraph: i, toParagraph: i + 1,
      quality: 'missing', comment: '',
    });
  }
  // Add a smooth one that should NOT be counted
  transitions.paragraphTransitions.push({
    fromParagraph: 10, toParagraph: 11,
    quality: 'smooth', comment: '',
  });
  return transitions;
}

function makePromptAnalysis(empty: number, partial: number): PromptAnalysis {
  return {
    matrix: {
      description: '', rowLabel: '', columnLabel: '',
      rows: [], columns: [],
    },
    questions: [],
    summary: {
      totalCells: 10,
      filledCells: 10 - empty - partial,
      emptyCells: empty,
      partialCells: partial,
      overallComment: '',
    },
  };
}

function makeCoachSynthesis(overrides: Partial<CoachSynthesis> = {}): CoachSynthesis {
  return {
    readiness: 'keep_going',
    coachNote: 'Focus on transitions.',
    recommendedReport: 'transitions',
    reportSummaries: [],
    improvements: null,
    ...overrides,
  };
}


// --- Tests ---

describe('createDraftEntity', () => {
  describe('analysisStatus', () => {
    it('returns "ready" when data field is non-null', () => {
      const entity = createDraftEntity(makeDraft({ evaluation: makeEvaluation() }));
      expect(entity.analysisStatus('overall')).toBe('ready');
    });

    it('returns "loading" when status exists and is not error', () => {
      const entity = createDraftEntity(makeDraft({
        evaluationStatus: { stage: 'thinking', message: 'Analyzing...' },
      }));
      expect(entity.analysisStatus('overall')).toBe('loading');
    });

    it('returns "error" when status stage is error', () => {
      const entity = createDraftEntity(makeDraft({
        grammarStatus: { stage: 'error', message: 'Something went wrong' },
      }));
      expect(entity.analysisStatus('grammar')).toBe('error');
    });

    it('returns "pending" when no data and no status', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.analysisStatus('overall')).toBe('pending');
      expect(entity.analysisStatus('grammar')).toBe('pending');
      expect(entity.analysisStatus('transitions')).toBe('pending');
      expect(entity.analysisStatus('prompt')).toBe('pending');
    });

    it('returns "ready" even when status also exists (data wins)', () => {
      const entity = createDraftEntity(makeDraft({
        grammarAnalysis: makeGrammarAnalysis(3),
        grammarStatus: { stage: 'error', message: 'stale error' },
      }));
      expect(entity.analysisStatus('grammar')).toBe('ready');
    });
  });

  describe('issueCount', () => {
    it('counts traits with non-null revisionPriority for overall', () => {
      const entity = createDraftEntity(makeDraft({
        evaluation: makeEvaluation(['ideas', 'voice', 'conventions']),
      }));
      expect(entity.issueCount('overall')).toBe(3);
    });

    it('returns totalErrors for grammar', () => {
      const entity = createDraftEntity(makeDraft({
        grammarAnalysis: makeGrammarAnalysis(7),
      }));
      expect(entity.issueCount('grammar')).toBe(7);
    });

    it('counts weak + missing transitions', () => {
      const entity = createDraftEntity(makeDraft({
        transitionAnalysis: makeTransitionAnalysis(2, 3),
      }));
      // 2 weak sentences + 3 missing paragraphs = 5 (smooth paragraph not counted)
      expect(entity.issueCount('transitions')).toBe(5);
    });

    it('sums emptyCells + partialCells for prompt', () => {
      const entity = createDraftEntity(makeDraft({
        promptAnalysis: makePromptAnalysis(2, 3),
      }));
      expect(entity.issueCount('prompt')).toBe(5);
    });

    it('returns undefined when analysis data is missing', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.issueCount('overall')).toBeUndefined();
      expect(entity.issueCount('grammar')).toBeUndefined();
      expect(entity.issueCount('transitions')).toBeUndefined();
      expect(entity.issueCount('prompt')).toBeUndefined();
    });
  });

  describe('coachReadiness', () => {
    it('returns readiness from coachSynthesis', () => {
      const entity = createDraftEntity(makeDraft({
        coachSynthesis: makeCoachSynthesis({ readiness: 'almost_there' }),
      }));
      expect(entity.coachReadiness).toBe('almost_there');
    });

    it('returns null when no coachSynthesis', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.coachReadiness).toBeNull();
    });
  });

  describe('coachNote', () => {
    it('returns coachNote from synthesis', () => {
      const entity = createDraftEntity(makeDraft({
        coachSynthesis: makeCoachSynthesis({ coachNote: 'Great transitions!' }),
      }));
      expect(entity.coachNote).toBe('Great transitions!');
    });

    it('returns null when no synthesis', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.coachNote).toBeNull();
    });
  });

  describe('recommendedReport', () => {
    it('maps recommendedReport from synthesis', () => {
      const entity = createDraftEntity(makeDraft({
        coachSynthesis: makeCoachSynthesis({ recommendedReport: 'grammar' }),
      }));
      expect(entity.recommendedReport).toBe('grammar');
    });

    it('returns null for "essay" recommendedReport (not an AnalysisKey)', () => {
      const entity = createDraftEntity(makeDraft({
        coachSynthesis: makeCoachSynthesis({ recommendedReport: 'essay' }),
      }));
      expect(entity.recommendedReport).toBeNull();
    });

    it('returns null when no synthesis', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.recommendedReport).toBeNull();
    });
  });

  describe('contentEdited', () => {
    it('returns true when editedAt > submittedAt', () => {
      const entity = createDraftEntity(makeDraft({
        submittedAt: new Date('2026-03-28T12:00:00Z'),
        editedAt: new Date('2026-03-28T12:05:00Z'),
      }));
      expect(entity.contentEdited).toBe(true);
    });

    it('returns false when editedAt is null', () => {
      const entity = createDraftEntity(makeDraft({ editedAt: null }));
      expect(entity.contentEdited).toBe(false);
    });

    it('returns false when editedAt is undefined', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.contentEdited).toBe(false);
    });

    it('returns false when editedAt <= submittedAt', () => {
      const submitted = new Date('2026-03-28T12:00:00Z');
      const entity = createDraftEntity(makeDraft({
        submittedAt: submitted,
        editedAt: submitted,
      }));
      expect(entity.contentEdited).toBe(false);
    });
  });

  describe('statusMessage', () => {
    it('returns message from status field', () => {
      const entity = createDraftEntity(makeDraft({
        evaluationStatus: { stage: 'thinking', message: 'Reading your essay...' },
      }));
      expect(entity.statusMessage('overall')).toBe('Reading your essay...');
    });

    it('returns null when no status field', () => {
      const entity = createDraftEntity(makeDraft());
      expect(entity.statusMessage('overall')).toBeNull();
    });
  });
});
