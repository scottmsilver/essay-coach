import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';

const stableEssays: any[] = [];
vi.mock('../hooks/useEssays', () => ({
  useEssays: () => ({ essays: stableEssays, loading: false }),
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(), query: vi.fn(), orderBy: vi.fn(),
  getDocs: vi.fn().mockResolvedValue({ docs: [] }),
  doc: vi.fn(), getDoc: vi.fn(), setDoc: vi.fn(), serverTimestamp: vi.fn(),
  onSnapshot: vi.fn(),
}));

// Mock recharts to avoid canvas issues in jsdom
vi.mock('recharts', () => ({
  LineChart: ({ children }: any) => <div data-testid="line-chart">{children}</div>,
  Line: () => null, XAxis: () => null, YAxis: () => null,
  Tooltip: () => null, Legend: () => null,
  ResponsiveContainer: ({ children }: any) => <div>{children}</div>,
}));

import ProgressPage from './ProgressPage';

describe('ProgressPage', () => {
  it('shows empty state when no data', async () => {
    renderWithRouter(<ProgressPage />);
    await waitFor(() => {
      expect(screen.getByText(/no progress data/i)).toBeInTheDocument();
    }, { timeout: 3000 });
  });
});
