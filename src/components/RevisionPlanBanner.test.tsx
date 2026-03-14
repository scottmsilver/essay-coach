import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import RevisionPlanBanner from './RevisionPlanBanner';

describe('RevisionPlanBanner', () => {
  it('renders nothing when revision plan is empty', () => {
    const { container } = renderWithRouter(<RevisionPlanBanner revisionPlan={[]} />);
    expect(container.querySelector('.revision-banner')).not.toBeInTheDocument();
  });

  it('renders all revision steps', () => {
    renderWithRouter(<RevisionPlanBanner revisionPlan={['Fix conventions', 'Improve organization']} />);
    expect(screen.getByText(/fix conventions/i)).toBeInTheDocument();
    expect(screen.getByText(/improve organization/i)).toBeInTheDocument();
  });

  it('highlights the first step as active', () => {
    const { container } = renderWithRouter(
      <RevisionPlanBanner revisionPlan={['First step', 'Second step']} />
    );
    const steps = container.querySelectorAll('.revision-step');
    expect(steps[0]).toHaveClass('active');
    expect(steps[1]).not.toHaveClass('active');
  });
});
