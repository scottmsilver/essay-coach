import type { GDocWebAppResponse } from '../../shared/gdocTypes';

const WEBAPP_BASE = 'https://script.google.com/macros/s';

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

/** Fetch doc info from Apps Script web app */
export async function fetchGDocInfo(
  docId: string,
  tab?: string | null,
): Promise<GDocWebAppResponse> {
  const deploymentId = getDeploymentId();
  const params = new URLSearchParams({ docId });
  if (tab) params.set('tab', tab);
  const url = `${WEBAPP_BASE}/${deploymentId}/exec?${params}`;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Failed to fetch document (${res.status})`);
  }
  const data: GDocWebAppResponse = await res.json();
  if (data.error) {
    throw new Error(data.error);
  }
  return data;
}
