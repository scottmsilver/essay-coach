#!/usr/bin/env npx tsx
/**
 * CLI tool to fetch a Google Doc and extract essay text.
 *
 * Usage:
 *   npx tsx scripts/fetch-gdoc.ts <doc-url-or-id> [options]
 *
 * Options:
 *   --tab <name>         Select a specific tab (default: first tab)
 *   --extract            Extract text between bookmarks (uses Apps Script)
 *   --raw                Dump full JSON from Google Docs REST API
 *   --info               Show tabs and bookmark info only (no full text)
 */

import * as fs from 'fs';
import { URL } from 'url';
import { SCRIPT_CONFIG_PATH, getAuthClient } from './oauth-helpers';
import { GDocWebAppResponse } from '../../shared/gdocTypes';

/** Extract doc ID from a Google Docs URL or return as-is if already an ID */
function extractDocId(input: string): string {
  try {
    const url = new URL(input);
    const match = url.pathname.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
    if (match) return match[1];
  } catch {
    // Not a URL — treat as raw ID
  }
  return input;
}

/** Call the Apps Script web app to get tab text + bookmark positions */
async function fetchViaAppsScript(docId: string, tabName: string | null): Promise<GDocWebAppResponse> {
  const config = JSON.parse(fs.readFileSync(SCRIPT_CONFIG_PATH, 'utf-8'));
  const baseUrl = `https://script.google.com/macros/s/${config.webAppDeploymentId}/exec`;
  const params = new URLSearchParams({ docId });
  if (tabName) params.set('tab', tabName);
  const url = `${baseUrl}?${params}`;

  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`Apps Script returned ${res.status}: ${await res.text()}`);
  }
  return res.json();
}

function parseArgs(args: string[]) {
  const tabIdx = args.indexOf('--tab');
  return {
    docInput: args[0],
    tabName: tabIdx >= 0 ? args[tabIdx + 1] : null,
    extract: args.includes('--extract'),
    raw: args.includes('--raw'),
    info: args.includes('--info'),
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) {
    console.error('Usage: npx tsx scripts/fetch-gdoc.ts <doc-url-or-id> [--tab <name>] [--extract] [--info] [--raw]');
    console.error('\n  --extract   Extract essay text between bookmarks');
    console.error('  --tab NAME  Select a specific tab');
    console.error('  --info      Show tab/bookmark info only');
    console.error('  --raw       Dump full REST API JSON');
    process.exit(1);
  }

  const { docInput, tabName, extract, raw, info } = parseArgs(args);
  const docId = extractDocId(docInput);

  if (raw) {
    // Raw mode: use REST API directly (needs googleapis + OAuth)
    const { google } = await import('googleapis');
    const oauth2Client = await getAuthClient();
    const docs = google.docs({ version: 'v1', auth: oauth2Client });
    const res = await docs.documents.get({ documentId: docId, includeTabsContent: true });
    console.log(JSON.stringify(res.data, null, 2));
    return;
  }

  // Use Apps Script web app for everything else
  console.error(`Fetching doc ${docId}...`);
  const data = await fetchViaAppsScript(docId, tabName);

  if (data.error) {
    console.error(`Error: ${data.error}`);
    process.exit(1);
  }

  if (info) {
    console.log(`Document tabs:`);
    for (const t of data.tabs) {
      const marker = t.id === data.tabId ? ' (selected)' : '';
      console.log(`  - "${t.title}"${marker}`);
    }
    console.log(`\nTab "${data.tabTitle}": ${data.textLength} chars, ${data.bookmarks.length} bookmarks`);
    if (data.bookmarks.length > 0) {
      console.log(`Bookmarks:`);
      for (const b of data.bookmarks) {
        const snippet = data.text.substring(b.offset, b.offset + 40).replace(/\n/g, '\\n');
        console.log(`  - ${b.id} @ offset ${b.offset}: "${snippet}..."`);
      }
    }
    return;
  }

  if (extract) {
    // Extract text between bookmarks
    if (data.bookmarks.length < 2) {
      console.error(`Need 2 bookmarks to extract, found ${data.bookmarks.length}.`);
      console.error('Add two bookmarks in Google Docs: Insert > Bookmark');
      if (data.bookmarks.length === 0) {
        console.error('Returning full tab text instead.\n');
        console.log(data.text);
      }
      process.exit(data.bookmarks.length === 0 ? 0 : 1);
    }

    const sorted = [...data.bookmarks].sort((a, b) => a.offset - b.offset);
    const start = sorted[0].offset;
    const end = sorted[sorted.length - 1].offset;
    const essay = data.text.substring(start, end).trim();

    console.error(`Tab: "${data.tabTitle}"`);
    console.error(`Extracted ${essay.length} chars between bookmarks (offsets ${start}..${end})`);
    console.error('');
    console.log(essay);
    return;
  }

  // Default: show tab info + full text
  console.error(`Tab: "${data.tabTitle}" (${data.textLength} chars, ${data.bookmarks.length} bookmarks)`);
  console.error(`Tabs: ${data.tabs.map(t => t.title).join(', ')}`);
  console.error('');
  console.log(data.text);
}

main().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
