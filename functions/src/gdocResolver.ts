import { WEBAPP_BASE, parseSections } from '../../shared/gdocTypes';
import type { DocSource, GDocWebAppResponse } from '../../shared/gdocTypes';

/**
 * Structural error from resolving a DocSource — the picked section can't be found
 * or the doc can't be read. Carries a user-facing message so the UI can guide
 * the student to re-pick the source in settings.
 *
 * Distinguished from transient network errors (which are plain Errors) because
 * these require user action, not a retry.
 */
export class GDocResolveError extends Error {
  readonly userMessage: string;
  constructor(detail: string, userMessage: string) {
    super(detail);
    this.name = 'GDocResolveError';
    this.userMessage = userMessage;
  }
}

/** Fetch with retry on 429 (rate limit). Max 2 retries with exponential backoff. */
async function fetchWithRetry(url: string, maxRetries = 2): Promise<Response> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, { redirect: 'follow' });
    if (res.status === 429 && attempt < maxRetries) {
      lastError = new Error(`Rate limited (429)`);
      await new Promise(r => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    return res;
  }
  throw lastError ?? new Error('Fetch failed after retries');
}

/**
 * Resolve a DocSource reference to fresh text by calling the Apps Script web app.
 * @param source - The doc reference (docId, tab, sectionIndex)
 * @param deploymentId - The Apps Script web app deployment ID
 * @returns The text content of the specified section
 * @throws GDocResolveError for structural failures (section missing, doc error)
 * @throws Error for transient failures (network, rate limit)
 */
export async function resolveDocSource(
  source: DocSource,
  deploymentId: string,
): Promise<string> {
  const params = new URLSearchParams({ docId: source.docId, tab: source.tab });
  // Re-read in the same projection the text was imported in (undefined = base).
  if (source.suggestionMode) params.set('suggestions', source.suggestionMode);
  const url = `${WEBAPP_BASE}/${deploymentId}/exec?${params}`;

  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Doc (${res.status})`);
  }

  let data: GDocWebAppResponse;
  try {
    data = await res.json();
  } catch {
    throw new Error('Invalid response from Google Docs service');
  }

  if (data.error) {
    throw new GDocResolveError(
      data.error,
      `Google Doc couldn't be read: ${data.error}. Open settings to re-pick the source.`,
    );
  }

  const sections = parseSections(data.text, data.bookmarks);
  if (source.sectionIndex < 0 || source.sectionIndex >= sections.length) {
    throw new GDocResolveError(
      `Section index ${source.sectionIndex} out of range (document has ${sections.length} section${sections.length === 1 ? '' : 's'})`,
      `The bookmarked section in your Google Doc can't be found — it may have been moved or deleted. Open settings to re-pick the section.`,
    );
  }

  return sections[source.sectionIndex];
}
