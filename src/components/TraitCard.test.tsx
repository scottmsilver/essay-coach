import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import TraitCard from './TraitCard';
import type { TraitEvaluation } from '../types';

const mockEval: TraitEvaluation = {
  score: 2,
  feedback: 'Multiple run-on sentences need fixing.',
  revisionPriority: 1,
  annotations: [
    { quotedText: 'Hamlet is a play about things', comment: 'Too vague' },
  ],
};

describe('TraitCard', () => {
  it('renders trait name and score', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.getByText('Conventions')).toBeInTheDocument();
    expect(screen.getByText('2/6 Emerging')).toBeInTheDocument();
  });

  it('renders feedback text', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.getByText(/run-on sentences/)).toBeInTheDocument();
  });

  it('applies score-low class for scores 1-2', () => {
    const { container } = renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(container.querySelector('.score-low')).toBeInTheDocument();
  });

  it('applies score-high class for scores 4+', () => {
    const highEval = { ...mockEval, score: 5 };
    const { container } = renderWithRouter(
      <TraitCard traitKey="voice" evaluation={highEval} expanded={false} onClick={vi.fn()} />
    );
    expect(container.querySelector('.score-high')).toBeInTheDocument();
  });

  it('applies score-mid class and shows rubric label for score 4', () => {
    const midEval = { ...mockEval, score: 4 };
    renderWithRouter(
      <TraitCard traitKey="voice" evaluation={midEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.getByText('4/6 Capable')).toBeInTheDocument();
  });

  it('shows annotations when expanded', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={true} onClick={vi.fn()} />
    );
    expect(screen.getByText(/too vague/i)).toBeInTheDocument();
  });

  it('hides annotations when collapsed', () => {
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={vi.fn()} />
    );
    expect(screen.queryByText(/too vague/i)).not.toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const onClick = vi.fn();
    renderWithRouter(
      <TraitCard traitKey="conventions" evaluation={mockEval} expanded={false} onClick={onClick} />
    );
    await userEvent.click(screen.getByText('Conventions'));
    expect(onClick).toHaveBeenCalled();
  });
});
