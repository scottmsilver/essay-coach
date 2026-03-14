import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

// Override mock for LoginPage-specific tests
const mockSignIn = vi.fn();
const mockLogOut = vi.fn();
let mockAuthState = {
  user: null as any,
  loading: false,
  allowed: null as boolean | null,
  signIn: mockSignIn,
  logOut: mockLogOut,
};

vi.mock('../hooks/useAuth', () => ({
  useAuth: () => mockAuthState,
}));

vi.mock('../firebase', () => ({
  auth: {},
  googleProvider: {},
  db: {},
  functions: {},
}));

import LoginPage from './LoginPage';

function renderLogin() {
  return render(
    <MemoryRouter>
      <LoginPage />
    </MemoryRouter>
  );
}

describe('LoginPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthState = {
      user: null,
      loading: false,
      allowed: null,
      signIn: mockSignIn,
      logOut: mockLogOut,
    };
  });

  it('shows loading state when auth is loading', () => {
    mockAuthState.loading = true;
    renderLogin();
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('shows Google sign-in button when not signed in', () => {
    renderLogin();
    expect(screen.getByText(/sign in with google/i)).toBeInTheDocument();
  });

  it('calls signIn when Google button is clicked', async () => {
    renderLogin();
    await userEvent.click(screen.getByText(/sign in with google/i));
    expect(mockSignIn).toHaveBeenCalled();
  });

  it('shows access denied when user is signed in but not allowed', () => {
    mockAuthState.user = { uid: 'u1', email: 'bad@gmail.com' };
    mockAuthState.allowed = false;
    renderLogin();
    expect(screen.getByText(/don't have access/i)).toBeInTheDocument();
  });

  it('shows sign out button on access denied', () => {
    mockAuthState.user = { uid: 'u1', email: 'bad@gmail.com' };
    mockAuthState.allowed = false;
    renderLogin();
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });
});
