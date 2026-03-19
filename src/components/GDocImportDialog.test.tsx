import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';

// Mock the import utilities
const mockFetchGDocInfo = vi.fn();
vi.mock('../utils/gdocImport', () => ({
  extractDocId: (input: string) => {
    const match = input.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : input;
  },
  fetchGDocInfo: (...args: unknown[]) => mockFetchGDocInfo(...args),
}));

vi.mock('../utils/googlePicker', () => ({
  openGooglePicker: vi.fn(),
}));

import GDocImportDialog from './GDocImportDialog';
import { openGooglePicker } from '../utils/googlePicker';

const mockOnImport = vi.fn();
const mockOnClose = vi.fn();

function renderDialog(props: Partial<React.ComponentProps<typeof GDocImportDialog>> = {}) {
  return renderWithRouter(
    <GDocImportDialog
      opened={true}
      onClose={mockOnClose}
      onImport={mockOnImport}
      label="essay"
      {...props}
    />
  );
}

describe('GDocImportDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ---- URL Step ----

  it('renders URL input and Browse My Docs button', () => {
    renderDialog();
    expect(screen.getByLabelText(/google docs url/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /fetch document/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /browse my docs/i })).toBeInTheDocument();
  });

  it('disables Fetch button when URL is empty', () => {
    renderDialog();
    expect(screen.getByRole('button', { name: /fetch document/i })).toBeDisabled();
  });

  it('pre-fills URL from initialUrl prop', () => {
    renderDialog({ initialUrl: 'https://docs.google.com/document/d/abc123/edit' });
    expect(screen.getByLabelText(/google docs url/i)).toHaveValue(
      'https://docs.google.com/document/d/abc123/edit'
    );
  });

  // ---- No bookmarks flow ----

  it('shows document preview with "Import entire document" when no bookmarks', async () => {
    const user = userEvent.setup();
    mockFetchGDocInfo
      .mockResolvedValueOnce({
        tabs: [{ title: 'Tab 1', id: 't1' }],
        text: '',
        bookmarks: [],
      })
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: 100,
        text: 'This is the full essay text about climate change and its effects on coastal communities.',
        bookmarks: [],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      });

    renderDialog();
    const urlInput = screen.getByLabelText(/google docs url/i);
    await user.type(urlInput, 'https://docs.google.com/document/d/test123/edit');
    await user.click(screen.getByRole('button', { name: /fetch document/i }));

    await waitFor(() => {
      expect(screen.getByText(/document preview/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/import entire document as essay|import entire tab .* as essay/i)).toBeInTheDocument();
    expect(screen.getByText(/i only want part of this (document|tab)/i)).toBeInTheDocument();
  });

  it('imports entire tab text when clicking "Import entire document"', async () => {
    const user = userEvent.setup();
    const essayText = 'Full essay content here.';
    mockFetchGDocInfo
      .mockResolvedValueOnce({
        tabs: [{ title: 'Tab 1', id: 't1' }],
        text: '',
        bookmarks: [],
      })
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: essayText.length,
        text: essayText,
        bookmarks: [],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      });

    renderDialog();
    await user.type(screen.getByLabelText(/google docs url/i), 'test-doc-id');
    await user.click(screen.getByRole('button', { name: /fetch document/i }));

    await waitFor(() => {
      expect(screen.getByText(/import entire (document|tab)/i)).toBeInTheDocument();
    });

    await user.click(screen.getByRole('button', { name: /import entire (document|tab)/i }));
    expect(mockOnImport).toHaveBeenCalledWith(
      essayText,
      { docId: 'test-doc-id', tab: 'Tab 1', sectionIndex: 0 },
      'test-doc-id'
    );
  });

  // ---- Bookmarks flow ----

  it('shows section radio list with word counts when bookmarks exist', async () => {
    const user = userEvent.setup();
    mockFetchGDocInfo
      .mockResolvedValueOnce({
        tabs: [{ title: 'Tab 1', id: 't1' }],
        text: '',
        bookmarks: [],
      })
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: 200,
        text: 'Section one text here.\nMore text in section one.\nSection two has different content here.',
        bookmarks: [{ id: 'bm1', offset: 49 }],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      });

    renderDialog();
    await user.type(screen.getByLabelText(/google docs url/i), 'doc-with-bookmarks');
    await user.click(screen.getByRole('button', { name: /fetch document/i }));

    await waitFor(() => {
      expect(screen.getByText(/2 sections found/i)).toBeInTheDocument();
    });

    // Section labels exist (may appear in both radio labels and button)
    expect(screen.getAllByText(/section 1/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getAllByText(/section 2/i).length).toBeGreaterThanOrEqual(1);
    // Word counts shown
    expect(screen.getAllByText(/words\)/i).length).toBeGreaterThanOrEqual(1);
  });

  // ---- Bookmark tutorial / refresh ----

  it('shows bookmark tutorial accordion and refresh button when no bookmarks', async () => {
    const user = userEvent.setup();
    mockFetchGDocInfo
      .mockResolvedValueOnce({
        tabs: [{ title: 'Tab 1', id: 't1' }],
        text: '',
        bookmarks: [],
      })
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: 50,
        text: 'Some document text.',
        bookmarks: [],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      });

    renderDialog();
    await user.type(screen.getByLabelText(/google docs url/i), 'doc-no-bm');
    await user.click(screen.getByRole('button', { name: /fetch document/i }));

    await waitFor(() => {
      expect(screen.getByText(/i only want part of this (document|tab)/i)).toBeInTheDocument();
    });

    // Expand accordion
    await user.click(screen.getByText(/i only want part of this (document|tab)/i));

    await waitFor(() => {
      expect(screen.getByText(/google docs bookmarks/i)).toBeInTheDocument();
    });

    expect(screen.getByText(/open in google docs/i)).toBeInTheDocument();
    expect(screen.getAllByText(/refresh/i).length).toBeGreaterThanOrEqual(1);
  });

  it('transitions from no-bookmarks to bookmarks view after refresh', async () => {
    const user = userEvent.setup();
    mockFetchGDocInfo
      .mockResolvedValueOnce({
        tabs: [{ title: 'Tab 1', id: 't1' }],
        text: '',
        bookmarks: [],
      })
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: 50,
        text: 'Prompt text.\nEssay text here.',
        bookmarks: [],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      })
      // After refresh, now has bookmarks
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: 50,
        text: 'Prompt text.\nEssay text here.',
        bookmarks: [{ id: 'bm1', offset: 13 }],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      });

    renderDialog();
    await user.type(screen.getByLabelText(/google docs url/i), 'doc-refresh');
    await user.click(screen.getByRole('button', { name: /fetch document/i }));

    await waitFor(() => {
      expect(screen.getByText(/document preview/i)).toBeInTheDocument();
    });

    // Expand accordion and click refresh
    await user.click(screen.getByText(/i only want part of this (document|tab)/i));
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /refresh/i })).toBeInTheDocument();
    });
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    // Should now show sections
    await waitFor(() => {
      expect(screen.getByText(/2 sections found/i)).toBeInTheDocument();
    });
  });

  // ---- Google Picker ----

  it('calls openGooglePicker when Browse My Docs is clicked', async () => {
    const user = userEvent.setup();
    const mockPicker = openGooglePicker as ReturnType<typeof vi.fn>;
    mockPicker.mockResolvedValueOnce(null); // user cancels

    renderDialog();
    await user.click(screen.getByRole('button', { name: /browse my docs/i }));

    expect(mockPicker).toHaveBeenCalled();
  });

  it('shows picker error gracefully when picker fails', async () => {
    const user = userEvent.setup();
    const mockPicker = openGooglePicker as ReturnType<typeof vi.fn>;
    mockPicker.mockRejectedValueOnce(new Error('Popup blocked'));

    renderDialog();
    await user.click(screen.getByRole('button', { name: /browse my docs/i }));

    await waitFor(() => {
      expect(screen.getByText(/popup blocked/i)).toBeInTheDocument();
    });
    // URL input is still usable
    expect(screen.getByLabelText(/google docs url/i)).toBeInTheDocument();
  });

  // ---- Empty content ----

  it('shows alert when document has no text', async () => {
    const user = userEvent.setup();
    mockFetchGDocInfo
      .mockResolvedValueOnce({
        tabs: [{ title: 'Tab 1', id: 't1' }],
        text: '',
        bookmarks: [],
      })
      .mockResolvedValueOnce({
        tabTitle: 'Tab 1',
        tabId: 't1',
        textLength: 0,
        text: '',
        bookmarks: [],
        tabs: [{ title: 'Tab 1', id: 't1' }],
      });

    renderDialog();
    await user.type(screen.getByLabelText(/google docs url/i), 'empty-doc');
    await user.click(screen.getByRole('button', { name: /fetch document/i }));

    await waitFor(() => {
      expect(screen.getByText(/no text content/i)).toBeInTheDocument();
    });
  });
});
