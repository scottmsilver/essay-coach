import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';

let mockAuth = { user: null as any, loading: false, allowed: null as boolean | null, signIn: vi.fn(), logOut: vi.fn() };
vi.mock('../hooks/useAuth', () => ({ useAuth: () => mockAuth }));
vi.mock('../firebase', () => ({ auth: {}, googleProvider: {}, db: {}, functions: {} }));

import ProtectedRoute from './ProtectedRoute';

describe('ProtectedRoute', () => {
  it('shows loading when auth is loading', () => {
    mockAuth = { ...mockAuth, loading: true };
    render(
      <MemoryRouter>
        <ProtectedRoute><div>Protected</div></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('redirects to /login when not authenticated', () => {
    mockAuth = { ...mockAuth, user: null, loading: false, allowed: null };
    render(
      <MemoryRouter initialEntries={['/protected']}>
        <Routes>
          <Route path="/login" element={<div>Login Page</div>} />
          <Route path="/protected" element={<ProtectedRoute><div>Protected</div></ProtectedRoute>} />
        </Routes>
      </MemoryRouter>
    );
    expect(screen.getByText('Login Page')).toBeInTheDocument();
  });

  it('renders children when authenticated and allowed', () => {
    mockAuth = { ...mockAuth, user: { uid: 'u1' }, loading: false, allowed: true };
    render(
      <MemoryRouter>
        <ProtectedRoute><div>Protected Content</div></ProtectedRoute>
      </MemoryRouter>
    );
    expect(screen.getByText('Protected Content')).toBeInTheDocument();
  });
});
