import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';

let mockEssaysState = { essays: [] as any[], loading: false };
vi.mock('../hooks/useEssays', () => ({
  useEssays: () => mockEssaysState,
}));

import HomePage from './HomePage';

describe('HomePage', () => {
  it('shows loading spinner when loading', () => {
    mockEssaysState = { essays: [], loading: true };
    renderWithRouter(<HomePage />);
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows empty state when no essays', () => {
    mockEssaysState = { essays: [], loading: false };
    renderWithRouter(<HomePage />);
    expect(screen.getByText(/no essays yet/i)).toBeInTheDocument();
    expect(screen.getByText(/personalized feedback/i)).toBeInTheDocument();
  });

  it('shows essay list when essays exist', () => {
    mockEssaysState = {
      essays: [
        { id: 'e1', title: 'Hamlet Analysis', writingType: 'analytical', currentDraftNumber: 2, updatedAt: new Date('2026-03-13'), createdAt: new Date() },
      ],
      loading: false,
    };
    renderWithRouter(<HomePage />);
    expect(screen.getByText('Hamlet Analysis')).toBeInTheDocument();
    expect(screen.getByText(/draft 2/i)).toBeInTheDocument();
  });
});
