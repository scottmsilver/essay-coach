import { describe, it, expect } from 'vitest';
import { screen, within } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import Layout from './Layout';

describe('Layout', () => {
  it('renders the brand name', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('EssayCoach')).toBeInTheDocument();
  });

  it('renders navigation links in header on non-essay routes', () => {
    renderWithRouter(<Layout />, { route: '/' });
    const header = document.querySelector('.mantine-AppShell-header')!;
    const headerScope = within(header as HTMLElement);
    expect(headerScope.getByText('New Essay')).toBeInTheDocument();
    expect(headerScope.getByText('My Essays')).toBeInTheDocument();
    expect(headerScope.getByText('Progress')).toBeInTheDocument();
    expect(headerScope.getByText('Sharing')).toBeInTheDocument();
  });

  it('renders user avatar with initials', () => {
    renderWithRouter(<Layout />);
    const avatar = document.querySelector('.mantine-Avatar-root');
    expect(avatar).toBeInTheDocument();
    expect(screen.getByText('T')).toBeInTheDocument();
  });

  it('hides header on essay routes', () => {
    renderWithRouter(<Layout />, { route: '/essay/e1' });
    const header = document.querySelector('.mantine-AppShell-header');
    expect(header).toBeNull();
  });

  it('hides header on shared essay routes', () => {
    renderWithRouter(<Layout />, { route: '/user/u1/essay/e1' });
    const header = document.querySelector('.mantine-AppShell-header');
    expect(header).toBeNull();
  });

  it('shows header on non-essay routes', () => {
    renderWithRouter(<Layout />, { route: '/' });
    const header = document.querySelector('.mantine-AppShell-header');
    expect(header).not.toBeNull();
  });
});
