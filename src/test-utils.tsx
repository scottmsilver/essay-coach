import { ReactNode } from 'react';
import { render, RenderOptions } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MantineProvider } from '@mantine/core';
import { vi } from 'vitest';

// Mock auth context values
export const mockAuthValue = {
  user: { uid: 'test-uid', email: 'test@gmail.com', displayName: 'Test', photoURL: null } as any,
  loading: false,
  allowed: true,
  signIn: vi.fn(),
  logOut: vi.fn(),
};

// Mock the useAuth hook globally for component tests
vi.mock('./hooks/useAuth', () => ({
  useAuth: () => mockAuthValue,
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

// Mock firebase client SDK
vi.mock('./firebase', () => ({
  auth: {},
  googleProvider: {},
  db: {},
  functions: {},
}));

interface WrapperOptions {
  route?: string;
}

export function renderWithRouter(
  ui: ReactNode,
  { route = '/', ...options }: WrapperOptions & RenderOptions = {}
) {
  return render(ui, {
    wrapper: ({ children }) => (
      <MantineProvider>
        <MemoryRouter initialEntries={[route]}>{children}</MemoryRouter>
      </MantineProvider>
    ),
    ...options,
  });
}
