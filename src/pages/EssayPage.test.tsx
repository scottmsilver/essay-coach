import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import type { Evaluation, TraitEvaluation } from '../types';

const makeTrait = (score: number, priority: number | null): TraitEvaluation => ({
  score, feedback: `Feedback for score ${score}`, revisionPriority: priority,
  annotations: [{ quotedText: 'sample', comment: 'comment' }],
});

const mockEval: Evaluation = {
  traits: {
    ideas: makeTrait(4, null), organization: makeTrait(3, 2), voice: makeTrait(5, null),
    wordChoice: makeTrait(3, 3), sentenceFluency: makeTrait(4, null),
    conventions: makeTrait(2, 1), presentation: makeTrait(4, null),
  },
  overallFeedback: 'Overall feedback text',
  revisionPlan: ['Fix conventions', 'Improve organization'],
  comparisonToPrevious: null,
};

let mockEssayState = {
  essay: { id: 'e1', title: 'Test Essay', writingType: 'argumentative', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
  drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay text', submittedAt: new Date(), evaluation: mockEval as Evaluation | null, revisionStage: null }],
  loading: false,
};

vi.mock('../hooks/useEssay', () => ({
  useEssay: () => mockEssayState,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ essayId: 'e1' }) };
});

import EssayPage from './EssayPage';

describe('EssayPage', () => {
  it('renders essay title', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Test Essay')).toBeInTheDocument();
  });

  it('renders all 7 trait cards', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Ideas')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Word Choice')).toBeInTheDocument();
    expect(screen.getByText('Sentence Fluency')).toBeInTheDocument();
    expect(screen.getByText('Conventions')).toBeInTheDocument();
    expect(screen.getByText('Presentation')).toBeInTheDocument();
  });

  it('renders revision plan banner', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/fix conventions/i)).toBeInTheDocument();
  });

  it('renders overall feedback', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Overall feedback text')).toBeInTheDocument();
  });

  it('renders Start Revising button for latest draft', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/start revising/i)).toBeInTheDocument();
  });

  it('shows error state when evaluation is null', () => {
    mockEssayState = {
      ...mockEssayState,
      drafts: [{ ...mockEssayState.drafts[0], evaluation: null }],
    };
    renderWithRouter(<EssayPage />);
    expect(screen.getAllByText(/failed|retry/i).length).toBeGreaterThan(0);
  });
});
