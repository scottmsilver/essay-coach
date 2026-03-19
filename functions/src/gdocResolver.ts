import { WEBAPP_BASE, parseSections } from '../../shared/gdocTypes';
import type { DocSource, GDocWebAppResponse } from '../../shared/gdocTypes';

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
 */
export async function resolveDocSource(
  source: DocSource,
  deploymentId: string,
): Promise<string> {
  const params = new URLSearchParams({ docId: source.docId, tab: source.tab });
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
    throw new Error(data.error);
  }

  const sections = parseSections(data.text, data.bookmarks);
  if (source.sectionIndex < 0 || source.sectionIndex >= sections.length) {
    throw new Error(
      `Section index ${source.sectionIndex} out of range (document has ${sections.length} section${sections.length === 1 ? '' : 's'})`,
    );
  }

  return sections[source.sectionIndex];
}
