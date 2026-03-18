import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resolveDocSource } from '../src/gdocResolver';

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal('fetch', mockFetch);

describe('resolveDocSource', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches text and returns correct section', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'PromptText\nEssayText\nBibliography',
        bookmarks: [
          { id: 'bm1', offset: 11 },
          { id: 'bm2', offset: 21 },
        ],
        tabs: [],
        tabTitle: 'Letter',
        tabId: 't.0',
        textLength: 33,
      }),
    });

    const text = await resolveDocSource(
      { docId: 'doc123', tab: 'Letter', sectionIndex: 1 },
      'test-deployment-id',
    );
    expect(text).toBe('EssayText');
    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain('docId=doc123');
    expect(url).toContain('tab=Letter');
  });

  it('returns full text when no bookmarks and sectionIndex 0', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Full essay text here',
        bookmarks: [],
        tabs: [],
        tabTitle: 'Tab1',
        tabId: 't.0',
        textLength: 20,
      }),
    });

    const text = await resolveDocSource(
      { docId: 'doc456', tab: 'Tab1', sectionIndex: 0 },
      'test-deployment-id',
    );
    expect(text).toBe('Full essay text here');
  });

  it('throws when section index is out of range', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        text: 'Only one section',
        bookmarks: [],
        tabs: [],
        tabTitle: 'Tab1',
        tabId: 't.0',
        textLength: 16,
      }),
    });

    await expect(
      resolveDocSource({ docId: 'doc789', tab: 'Tab1', sectionIndex: 5 }, 'test-id'),
    ).rejects.toThrow(/section/i);
  });

  it('throws when web app returns error', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ error: 'Tab not found' }),
    });

    await expect(
      resolveDocSource({ docId: 'doc000', tab: 'Missing', sectionIndex: 0 }, 'test-id'),
    ).rejects.toThrow('Tab not found');
  });

  it('throws on HTTP error', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500, text: async () => 'Server error' });

    await expect(
      resolveDocSource({ docId: 'doc000', tab: 'Tab', sectionIndex: 0 }, 'test-id'),
    ).rejects.toThrow(/500/);
  });
});
