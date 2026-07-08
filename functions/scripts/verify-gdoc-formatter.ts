/**
 * Before/after equivalence harness (spec gate).
 * Fetches every Google Doc referenced by any essay in Firestore through BOTH
 * the old (DocumentApp) and new (Docs API) web-app deployments in base mode,
 * and requires identical text, bookmarks, and tab lists.
 *
 * Usage:
 *   OLD_DEPLOYMENT_ID=AKfy... NEW_DEPLOYMENT_ID=AKfy... \
 *     npx tsx scripts/verify-gdoc-formatter.ts [--limit N]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const WEBAPP_BASE = 'https://script.google.com/macros/s';
const OLD_ID = process.env.OLD_DEPLOYMENT_ID;
const NEW_ID = process.env.NEW_DEPLOYMENT_ID;
if (!OLD_ID || !NEW_ID) {
  console.error('Set OLD_DEPLOYMENT_ID and NEW_DEPLOYMENT_ID');
  process.exit(1);
}

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

interface WebAppResp {
  text?: string;
  bookmarks?: Array<{ id: string; offset: number }>;
  tabs?: Array<{ title: string; id: string }>;
  error?: string;
}

async function fetchDeployment(deploymentId: string, docId: string, tab: string): Promise<WebAppResp> {
  const params = new URLSearchParams({ docId });
  if (tab) params.set('tab', tab);
  const res = await fetch(`${WEBAPP_BASE}/${deploymentId}/exec?${params}`, { redirect: 'follow' });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  try { return await res.json() as WebAppResp; } catch { return { error: 'non-JSON response' }; }
}

function firstDiff(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      return `first divergence at char ${i}:\n  old: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}\n  new: ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`;
    }
  }
  return `length differs: old=${a.length} new=${b.length}\n  old tail: ${JSON.stringify(a.slice(max - 40))}\n  new tail: ${JSON.stringify(b.slice(max - 40))}`;
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: 'essay-grader-83737x' });
  const db = getFirestore();

  // Collect distinct (docId, tab) pairs from all essays' source fields.
  const pairs = new Map<string, { docId: string; tab: string }>();
  const essays = await db.collectionGroup('essays').get();
  for (const doc of essays.docs) {
    const d = doc.data();
    for (const field of ['contentSource', 'promptSource', 'criteriaSource'] as const) {
      const s = d[field];
      if (s && typeof s.docId === 'string') {
        const key = `${s.docId}::${s.tab || ''}`;
        pairs.set(key, { docId: s.docId, tab: s.tab || '' });
      }
    }
  }
  console.log(`Found ${pairs.size} distinct (docId, tab) pairs across ${essays.size} essays.\n`);

  let pass = 0, fail = 0, skip = 0, n = 0;
  for (const { docId, tab } of pairs.values()) {
    if (++n > LIMIT) break;
    const label = `${docId.slice(0, 10)}…${tab ? ` [${tab}]` : ''}`;

    // OLD_ID/NEW_ID are guaranteed non-undefined by the guard above; the ! is
    // needed because TS discards module-scope narrowing inside this closure.
    const oldResp = await fetchDeployment(OLD_ID!, docId, tab);
    if (oldResp.error) { console.log(`SKIP ${label} — old deployment: ${oldResp.error}`); skip++; continue; }
    const newResp = await fetchDeployment(NEW_ID!, docId, tab);
    if (newResp.error) { console.log(`FAIL ${label} — new deployment: ${newResp.error}`); fail++; continue; }

    const problems: string[] = [];
    if (oldResp.text !== newResp.text) problems.push(`TEXT MISMATCH — ${firstDiff(oldResp.text ?? '', newResp.text ?? '')}`);
    if (JSON.stringify(oldResp.bookmarks) !== JSON.stringify(newResp.bookmarks)) {
      problems.push(`BOOKMARKS MISMATCH — old=${JSON.stringify(oldResp.bookmarks)} new=${JSON.stringify(newResp.bookmarks)}`);
    }
    if (JSON.stringify(oldResp.tabs) !== JSON.stringify(newResp.tabs)) {
      problems.push(`TABS MISMATCH — old=${JSON.stringify(oldResp.tabs)} new=${JSON.stringify(newResp.tabs)}`);
    }

    if (problems.length === 0) { console.log(`PASS ${label}`); pass++; }
    else { console.log(`FAIL ${label}\n  ${problems.join('\n  ')}`); fail++; }

    await new Promise(r => setTimeout(r, 300)); // stay under Apps Script quotas
  }

  console.log(`\n=== ${pass} PASS, ${fail} FAIL, ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
