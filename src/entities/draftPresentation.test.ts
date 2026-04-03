import { describe, it, expect } from 'vitest';
import { presentDraft } from './draftPresentation';
import { createDraftEntity } from './draftEntity';
import type { Draft, CoachSynthesis } from '../types';

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

function makeEvaluation() {
  const traitKeys = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'] as const;
  const traits = {} as Record<typeof traitKeys[number], { score: number; feedback: string; revisionPriority: number | null; annotations: [] }>;
  for (const key of traitKeys) {
    traits[key] = { score: 4, feedback: '', revisionPriority: null, annotations: [] };
  }
  return { traits, overallFeedback: '', revisionPlan: [] as string[], comparisonToPrevious: null };
}

function makeGrammarAnalysis() {
  const emptyCategory = { locations: [] };
  return {
    commaSplices: emptyCategory, runOnSentences: emptyCategory, fragments: emptyCategory,
    subjectVerbAgreement: emptyCategory, pronounReference: emptyCategory, verbTenseConsistency: emptyCategory,
    parallelStructure: emptyCategory, punctuationErrors: emptyCategory, missingCommas: emptyCategory,
    sentenceVariety: { avgLength: 15, distribution: { simple: 5, compound: 3, complex: 2, compoundComplex: 1 }, comment: '' },
    activePassiveVoice: { activeCount: 8, passiveCount: 2, passiveInstances: [] },
    modifierPlacement: { issues: [] }, wordiness: { instances: [] },
    summary: { totalErrors: 3, errorsByCategory: { commaSplices: 0, runOnSentences: 0, fragments: 0, subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0, parallelStructure: 0, punctuationErrors: 0, missingCommas: 0 }, overallComment: '', strengthAreas: [], priorityFixes: [] },
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

function present(draftOverrides: Partial<Draft> = {}, draftAge = 30_000, hasPrompt = true, isLatest = true, isOwner = true) {
  const entity = createDraftEntity(makeDraft(draftOverrides));
  return presentDraft(entity, draftAge, hasPrompt, isLatest, isOwner);
}

// --- Tests ---

describe('presentDraft', () => {
  describe('report time heuristics', () => {
    it('maps pending to loading when draft is fresh (< 60s)', () => {
      const p = present({}, 30_000);
      expect(p.reports.overall.status).toBe('loading');
    });

    it('maps pending to pending when draft is between 60s-180s', () => {
      const p = present({}, 120_000);
      expect(p.reports.overall.status).toBe('pending');
    });

    it('maps pending overall to stale when draft is old (>= 180s)', () => {
      const p = present({}, 200_000);
      expect(p.reports.overall.status).toBe('stale');
    });

    it('keeps non-overall pending as pending even when old (>= 180s)', () => {
      const p = present({}, 200_000);
      expect(p.reports.grammar.status).toBe('pending');
      expect(p.reports.transitions.status).toBe('pending');
    });
  });

  describe('stale_content', () => {
    it('returns stale_content when entity is ready and content was edited', () => {
      const p = present({
        evaluation: makeEvaluation(),
        editedAt: new Date('2026-03-28T12:05:00Z'),
      });
      expect(p.reports.overall.status).toBe('stale_content');
    });

    it('returns ready when entity is ready and content was NOT edited', () => {
      const p = present({ evaluation: makeEvaluation() });
      expect(p.reports.overall.status).toBe('ready');
    });
  });

  describe('prompt unavailable', () => {
    it('returns unavailable for prompt when hasPrompt is false', () => {
      const p = present({}, 30_000, false);
      expect(p.reports.prompt.status).toBe('unavailable');
    });

    it('returns loading for prompt when hasPrompt is true and pending + fresh', () => {
      const p = present({}, 30_000, true);
      expect(p.reports.prompt.status).toBe('loading');
    });
  });

  describe('report status passthrough', () => {
    it('returns error when entity analysis is error', () => {
      const p = present({ grammarStatus: { stage: 'error', message: 'fail' } });
      expect(p.reports.grammar.status).toBe('error');
    });

    it('returns loading when entity analysis is loading', () => {
      const p = present({ grammarStatus: { stage: 'thinking', message: 'Working...' } });
      expect(p.reports.grammar.status).toBe('loading');
    });
  });

  describe('issueCount and statusMessage', () => {
    it('passes issueCount from entity', () => {
      const p = present({ grammarAnalysis: makeGrammarAnalysis() });
      expect(p.reports.grammar.issueCount).toBe(3);
    });

    it('passes statusMessage from entity', () => {
      const p = present({
        evaluationStatus: { stage: 'thinking', message: 'Reading your essay...' },
      });
      expect(p.reports.overall.statusMessage).toBe('Reading your essay...');
    });
  });

  describe('isRecommended', () => {
    it('marks recommended report from entity', () => {
      const p = present({
        coachSynthesis: makeCoachSynthesis({ recommendedReport: 'grammar' }),
      });
      expect(p.reports.grammar.isRecommended).toBe(true);
      expect(p.reports.overall.isRecommended).toBe(false);
      expect(p.reports.transitions.isRecommended).toBe(false);
    });
  });

  describe('verdict phase', () => {
    it('returns has_verdict when synthesis exists', () => {
      const p = present({ coachSynthesis: makeCoachSynthesis() });
      expect(p.verdict.phase).toBe('has_verdict');
      expect(p.verdict.coachReadiness).toBe('keep_going');
      expect(p.verdict.coachNote).toBe('Focus on transitions.');
    });

    it('returns error when synthesisStatus has error stage', () => {
      const p = present({
        coachSynthesisStatus: { stage: 'error', message: 'Failed' },
      });
      expect(p.verdict.phase).toBe('error');
    });

    it('returns analyzing when synthesisStatus exists but is not error', () => {
      const p = present({
        coachSynthesisStatus: { stage: 'thinking', message: 'Analyzing...' },
      });
      expect(p.verdict.phase).toBe('analyzing');
    });

    it('returns old_data when no synthesis, no status, and draftAge > 5min', () => {
      const p = present({}, 400_000);
      expect(p.verdict.phase).toBe('old_data');
    });

    it('returns waiting when no synthesis, no status, and draftAge <= 5min', () => {
      const p = present({}, 60_000);
      expect(p.verdict.phase).toBe('waiting');
    });
  });

  describe('canEdit', () => {
    it('is true when owner and latest', () => {
      const p = present({}, 30_000, true, true, true);
      expect(p.canEdit).toBe(true);
    });

    it('is true for shared users on latest draft', () => {
      const p = present({}, 30_000, true, true, false);
      expect(p.canEdit).toBe(true);
    });

    it('is false when not latest', () => {
      const p = present({}, 30_000, true, false, true);
      expect(p.canEdit).toBe(false);
    });
  });

  describe('hasPrompt and isLatest passthrough', () => {
    it('passes hasPrompt and isLatest through', () => {
      const p = present({}, 30_000, false, false);
      expect(p.hasPrompt).toBe(false);
      expect(p.isLatest).toBe(false);
    });
  });
});
