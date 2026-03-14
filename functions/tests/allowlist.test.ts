import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock firebase-admin before importing allowlist
vi.mock('firebase-admin/firestore', () => {
  const mockGet = vi.fn();
  return {
    getFirestore: () => ({
      doc: () => ({ get: mockGet }),
    }),
    __mockGet: mockGet,
  };
});

import { isEmailAllowed } from '../src/allowlist';
import { __mockGet } from 'firebase-admin/firestore';

const mockGet = __mockGet as ReturnType<typeof vi.fn>;

describe('isEmailAllowed', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns true for an email on the allowlist', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com', 'other@gmail.com'] }),
    });
    expect(await isEmailAllowed('test@gmail.com')).toBe(true);
  });

  it('returns false for an email not on the allowlist', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    expect(await isEmailAllowed('hacker@evil.com')).toBe(false);
  });

  it('returns false when allowlist doc does not exist', async () => {
    mockGet.mockResolvedValue({ exists: false });
    expect(await isEmailAllowed('test@gmail.com')).toBe(false);
  });

  it('is case-insensitive', async () => {
    mockGet.mockResolvedValue({
      exists: true,
      data: () => ({ emails: ['test@gmail.com'] }),
    });
    expect(await isEmailAllowed('Test@Gmail.com')).toBe(true);
  });
});
