import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin before importing admins
vi.mock('firebase-admin/firestore', () => {
  const mockGet = vi.fn();
  return {
    getFirestore: () => ({
      doc: () => ({ get: mockGet }),
    }),
    __mockGet: mockGet,
  };
});

import { isEmailAdmin } from '../src/admins';
import { __mockGet } from 'firebase-admin/firestore';

const mockGet = __mockGet as ReturnType<typeof vi.fn>;

describe('isEmailAdmin', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for an email on the admin list', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['admin@gmail.com', 'other@gmail.com'] }),
    });
    expect(await isEmailAdmin('admin@gmail.com')).toBe(true);
  });

  it('returns false for an email not on the admin list', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['admin@gmail.com'] }),
    });
    expect(await isEmailAdmin('user@gmail.com')).toBe(false);
  });

  it('returns false when admin doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await isEmailAdmin('admin@gmail.com')).toBe(false);
  });

  it('returns false for undefined email', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['admin@gmail.com'] }),
    });
    expect(await isEmailAdmin(undefined)).toBe(false);
  });

  it('is case-insensitive', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['admin@gmail.com'] }),
    });
    expect(await isEmailAdmin('Admin@Gmail.com')).toBe(true);
  });
});
