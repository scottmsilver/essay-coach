import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import Layout from './Layout';

describe('Layout', () => {
  it('renders the brand name', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('EssayCoach')).toBeInTheDocument();
  });

  it('renders "+ New Essay" button in header', () => {
    renderWithRouter(<Layout />, { route: '/' });
    expect(screen.getByText('+ New Essay')).toBeInTheDocument();
  });

  it('renders user avatar with initials', () => {
    renderWithRouter(<Layout />);
    const avatar = document.querySelector('.mantine-Avatar-root');
    expect(avatar).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('shows header on home route', () => {
    renderWithRouter(<Layout />, { route: '/' });
    const header = document.querySelector('.mantine-AppShell-header');
    expect(header).not.toBeNull();
  });

  it('shows header on essay routes', () => {
    renderWithRouter(<Layout />, { route: '/essay/e1' });
    const header = document.querySelector('.mantine-AppShell-header');
    expect(header).not.toBeNull();
  });

  it('shows header on shared essay routes', () => {
    renderWithRouter(<Layout />, { route: '/user/u1/essay/e1' });
    const header = document.querySelector('.mantine-AppShell-header');
    expect(header).not.toBeNull();
  });
});
