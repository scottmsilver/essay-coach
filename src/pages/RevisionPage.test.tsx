import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import type { Evaluation, TraitEvaluation } from '../types';

const makeTrait = (score: number, priority: number | null): TraitEvaluation => ({
  score, feedback: `Feedback ${score}`, revisionPriority: priority,
  annotations: [{ quotedText: 'quoted passage', comment: 'fix this' }],
});

const mockEval: Evaluation = {
  traits: {
    ideas: makeTrait(4, null), organization: makeTrait(3, 2), voice: makeTrait(5, null),
    wordChoice: makeTrait(3, 3), sentenceFluency: makeTrait(4, null),
    conventions: makeTrait(2, 1), presentation: makeTrait(4, null),
  },
  overallFeedback: 'Overall', revisionPlan: ['Fix conventions'], comparisonToPrevious: null,
};

vi.mock('../hooks/useEssay', () => ({
  useEssay: () => ({
    essay: { id: 'e1', title: 'Test Essay', writingType: 'analytical', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
    drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay content with quoted passage here.', submittedAt: new Date(), evaluation: mockEval, revisionStage: null }],
    loading: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ essayId: 'e1' }), useNavigate: () => vi.fn() };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn().mockResolvedValue({ data: {} }),
}));

import RevisionPage from './RevisionPage';

describe('RevisionPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the essay title with Revision', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/test essay/i)).toBeInTheDocument();
    expect(screen.getByText(/revision/i)).toBeInTheDocument();
  });

  it('renders hamburger menu button', () => {
    const { container } = renderWithRouter(<RevisionPage />);
    expect(container.querySelector('.hamburger-btn')).toBeInTheDocument();
  });

  it('renders trait score pills with full names', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getAllByText(/conventions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/organization/i).length).toBeGreaterThan(0);
  });

  it('renders the essay text in a textarea', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByDisplayValue(/essay content/i)).toBeInTheDocument();
  });

  it('renders feedback panel', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/fix this/i)).toBeInTheDocument();
  });

  it('renders Resubmit button in analysis bar', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/resubmit/i)).toBeInTheDocument();
  });

  it('saves to localStorage on edit (autosave)', async () => {
    renderWithRouter(<RevisionPage />);
    const textarea = screen.getByDisplayValue(/essay content/i);
    await userEvent.type(textarea, ' new text');
    expect(localStorage.getItem('essaycoach_autosave_e1')).toContain('new text');
  });
});
