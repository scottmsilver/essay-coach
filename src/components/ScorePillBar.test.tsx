import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import ScorePillBar from './ScorePillBar';
import type { Evaluation } from '../types';

const evaluation: Evaluation = {
  traits: {
    ideas: { score: 4, feedback: 'Ideas are developing.', revisionPriority: 1, annotations: [] },
    organization: { score: 3, feedback: 'Organization is developing.', revisionPriority: 1, annotations: [] },
    voice: { score: 2, feedback: 'Voice needs work.', revisionPriority: 1, annotations: [] },
    wordChoice: { score: 1, feedback: 'Word choice is weak.', revisionPriority: 1, annotations: [] },
    sentenceFluency: { score: 5, feedback: 'Sentence fluency is strong.', revisionPriority: 1, annotations: [] },
    conventions: { score: 6, feedback: 'Conventions are strong.', revisionPriority: 1, annotations: [] },
    presentation: { score: 4, feedback: 'Presentation is developing.', revisionPriority: 1, annotations: [] },
  },
  overallFeedback: 'Overall feedback.',
  revisionPlan: [],
  comparisonToPrevious: null,
};

describe('ScorePillBar', () => {
  it('applies the mid score class and tooltip for score 4', () => {
    renderWithRouter(
      <ScorePillBar evaluation={evaluation} onSelect={vi.fn()} />
    );

    const ideasPill = screen.getByText('Ideas').closest('button');
    if (!ideasPill) throw new Error('Expected Ideas pill button');
    expect(ideasPill).toHaveClass('score-pill');
    expect(ideasPill).toHaveClass('mid');
    expect(ideasPill).toHaveAttribute('title', '3-4: developing / capable');
  });
});
