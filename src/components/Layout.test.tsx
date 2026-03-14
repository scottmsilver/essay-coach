import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import Layout from './Layout';

describe('Layout', () => {
  it('renders the brand name', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('EssayCoach')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('New Essay')).toBeInTheDocument();
    expect(screen.getByText('My Essays')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });
});
