import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import ScoreDelta from './ScoreDelta';

describe('ScoreDelta', () => {
  it('shows positive change with up arrow', () => {
    renderWithRouter(<ScoreDelta previous={2} current={4} />);
    const el = screen.getByText(/2 → 4/);
    expect(el).toBeInTheDocument();
    expect(el).toHaveClass('positive');
  });

  it('shows negative change with down arrow', () => {
    renderWithRouter(<ScoreDelta previous={4} current={3} />);
    const el = screen.getByText(/4 → 3/);
    expect(el).toHaveClass('negative');
  });

  it('shows neutral when no change', () => {
    renderWithRouter(<ScoreDelta previous={3} current={3} />);
    const el = screen.getByText(/3 → 3/);
    expect(el).toHaveClass('neutral');
  });
});
