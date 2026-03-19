import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay text with sample quoted here', submittedAt: new Date(), evaluation: mockEval as Evaluation | null, revisionStage: null }],
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
  beforeEach(() => {
    mockEssayState = {
      essay: { id: 'e1', title: 'Test Essay', writingType: 'argumentative', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
      drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay text with sample quoted here', submittedAt: new Date(), evaluation: mockEval as Evaluation | null, revisionStage: null }],
      loading: false,
    };
  });

  it('renders essay title', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Test Essay')).toBeInTheDocument();
  });

  it('renders all 7 trait score pills with full names', () => {
    const { container } = renderWithRouter(<EssayPage />);
    const pills = container.querySelectorAll('.score-pill-label');
    const labels = Array.from(pills).map((el) => el.textContent);
    expect(labels).toEqual(['Ideas', 'Organization', 'Voice', 'Word Choice', 'Sentence Fluency', 'Conventions', 'Presentation']);
  });

  it('renders burger menu button', () => {
    const { container } = renderWithRouter(<EssayPage />);
    expect(container.querySelector('.mantine-Burger-root')).toBeInTheDocument();
  });

  it('renders view type dropdown', () => {
    const { container } = renderWithRouter(<EssayPage />);
    expect(container.querySelector('.mantine-Select-input')).toBeInTheDocument();
  });

  it('renders revision plan', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/fix conventions/i)).toBeInTheDocument();
  });

  it('renders overall feedback', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Overall feedback text')).toBeInTheDocument();
  });

  it('renders Revise button for latest draft', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/^revise$/i)).toBeInTheDocument();
  });

  it('renders user avatar', () => {
    const { container } = renderWithRouter(<EssayPage />);
    expect(container.querySelector('.mantine-Avatar-root')).toBeInTheDocument();
  });

  it('shows loading state for recent draft with null evaluation', () => {
    mockEssayState = {
      ...mockEssayState,
      drafts: [{ ...mockEssayState.drafts[0], evaluation: null, submittedAt: new Date() }],
    };
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/evaluating/i)).toBeInTheDocument();
  });

  it('shows error state for old draft with null evaluation', () => {
    mockEssayState = {
      ...mockEssayState,
      drafts: [{ ...mockEssayState.drafts[0], evaluation: null, submittedAt: new Date(Date.now() - 300000) }],
    };
    renderWithRouter(<EssayPage />);
    expect(screen.getAllByText(/failed|retry/i).length).toBeGreaterThan(0);
  });

  it('enters revision mode when Revise is clicked', async () => {
    const usr = userEvent.setup();
    renderWithRouter(<EssayPage />);
    const reviseButton = screen.getByText(/^revise$/i);
    await usr.click(reviseButton);
    expect(screen.getByText('Resubmit for Feedback')).toBeInTheDocument();
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    expect(screen.getByText(/edit your essay below/i)).toBeInTheDocument();
  });

  it('exits revision mode when Cancel is clicked', async () => {
    const usr = userEvent.setup();
    renderWithRouter(<EssayPage />);
    await usr.click(screen.getByText(/^revise$/i));
    expect(screen.getByText('Cancel')).toBeInTheDocument();
    await usr.click(screen.getByText('Cancel'));
    expect(screen.getByText(/^revise$/i)).toBeInTheDocument();
    expect(screen.queryByText('Cancel')).not.toBeInTheDocument();
  });
});
