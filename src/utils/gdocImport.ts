import { WEBAPP_BASE } from '../../shared/gdocTypes';
import type { GDocWebAppResponse } from '../../shared/gdocTypes';

function getDeploymentId(): string {
  const id = import.meta.env.VITE_GDOC_WEBAPP_DEPLOYMENT_ID;
  if (!id) throw new Error('VITE_GDOC_WEBAPP_DEPLOYMENT_ID not configured');
  return id;
}

/** Extract doc ID from a Google Docs URL or return as-is if already an ID */
export function extractDocId(input: string): string {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  } catch {
    // Not a URL — treat as raw ID
  }
  return input;
}

/** Extract tab hint from URL hash (e.g., ?tab=t.0) */
export function extractTabHint(input: string): string | null {
  try {
    const url = new URL(input);
    return url.searchParams.get('tab');
  } catch {
    return null;
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

/** Fetch doc info from Apps Script web app */
export async function fetchGDocInfo(
  docId: string,
  tab?: string | null,
): Promise<GDocWebAppResponse> {
  const deploymentId = getDeploymentId();
  const params = new URLSearchParams({ docId });
  if (tab) params.set('tab', tab);
  const url = `${WEBAPP_BASE}/${deploymentId}/exec?${params}`;

  const res = await fetchWithRetry(url);
  if (!res.ok) {
    throw new Error(`Failed to fetch document (${res.status})`);
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
  return data;
}
