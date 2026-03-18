import { parseSections } from '../../shared/gdocTypes';
import type { DocSource, GDocWebAppResponse } from '../../shared/gdocTypes';

const WEBAPP_BASE = 'https://script.google.com/macros/s';

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

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google Doc (${res.status})`);
  }

  const data: GDocWebAppResponse = await res.json();
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
