/** Apps Script web app base URL */
export const WEBAPP_BASE = 'https://script.google.com/macros/s';

/** Reference to a section within a Google Doc tab */
export interface DocSource {
  docId: string;
  tab: string;
  sectionIndex: number;
}

/** Bookmark position as returned by the Apps Script web app */
export interface GDocBookmark {
  id: string;
  offset: number;
}

/** Response from the Apps Script web app */
export interface GDocWebAppResponse {
  tabTitle: string;
  tabId: string;
  textLength: number;
  text: string;
  bookmarks: GDocBookmark[];
  tabs: Array<{ title: string; id: string }>;
  error?: string;
}

/** Strip leading newlines/spaces (but not tabs — preserves indentation) and trailing whitespace. */
function trimSection(s: string): string {
  return s.replace(/^[\n ]+/, '').replace(/\s+$/, '');
}

/**
 * Split tab text into sections using bookmark offsets as dividers.
 * - 0 bookmarks → 1 section (entire text)
 * - N bookmarks → up to N+1 sections
 * Empty sections are filtered out. Sections are trimmed.
 */
export function parseSections(
  text: string,
  bookmarks: GDocBookmark[],
): string[] {
  if (bookmarks.length === 0) {
    const s = trimSection(text);
    return s.length > 0 ? [s] : [];
  }

  const offsets = [0, ...bookmarks.map(b => b.offset), text.length];
  const unique = [...new Set(offsets)].sort((a, b) => a - b);

  return unique
    .slice(0, -1)
    .map((start, i) => trimSection(text.substring(start, unique[i + 1])))
    .filter(s => s.length > 0);
}
