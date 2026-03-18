import { describe, it, expect, vi } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn().mockResolvedValue({ data: { essayId: 'new1' } }),
}));

import NewEssayPage from './NewEssayPage';

describe('NewEssayPage', () => {
  it('renders all form fields', () => {
    renderWithRouter(<NewEssayPage />);
    expect(screen.getByLabelText(/title/i)).toBeInTheDocument();
    expect(screen.getByText(/writing type/i)).toBeInTheDocument();
    expect(screen.getByText(/assignment prompt/i)).toBeInTheDocument();
    expect(screen.getByText(/your essay/i)).toBeInTheDocument();
  });

  it('shows word count', async () => {
    renderWithRouter(<NewEssayPage />);
    const textarea = screen.getByPlaceholderText(/paste or type your essay/i);
    await userEvent.type(textarea, 'one two three four five');
    expect(screen.getByText(/5/)).toBeInTheDocument();
  });

  it('disables submit when fields are empty', () => {
    renderWithRouter(<NewEssayPage />);
    const submitBtn = screen.getByRole('button', { name: /submit/i });
    expect(submitBtn).toBeDisabled();
  });
});
