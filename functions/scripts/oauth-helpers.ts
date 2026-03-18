/**
 * Shared OAuth helpers for Google Apps Script management scripts.
 * Used by setup-apps-script.ts, update-apps-script.ts, and fetch-gdoc.ts.
 */

import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';

export const TOKEN_PATH = path.join(__dirname, 'gdocs-token.json');
export const OAUTH_PATH = path.join(__dirname, 'gdocs-oauth.json');
export const SCRIPT_CONFIG_PATH = path.join(__dirname, 'gdocs-script-id.json');
export const REDIRECT_PORT = 3333;
export const REDIRECT_URI = `http://localhost:${REDIRECT_PORT}/oauth2callback`;

/** Create an OAuth2 client from the stored credentials file. */
export function loadOAuthClient() {
  const creds = JSON.parse(fs.readFileSync(OAUTH_PATH, 'utf-8'));
  const { client_id, client_secret } = creds.installed;
  return new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
}

/**
 * Load stored token and refresh if expired.
 * Returns a ready-to-use OAuth2 client.
 * Does NOT handle first-time authorization — see setup-apps-script.ts for that.
 */
export async function getAuthClient() {
  const oauth2Client = loadOAuthClient();
  const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf-8'));
  oauth2Client.setCredentials(token);

  if (token.expiry_date && token.expiry_date < Date.now() && token.refresh_token) {
    console.log('Refreshing OAuth token...');
    const { credentials } = await oauth2Client.refreshAccessToken();
    oauth2Client.setCredentials(credentials);
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(credentials, null, 2));
  }

  return oauth2Client;
}

/** Top-level error handler for script main() functions. */
export function handleScriptError(err: unknown): never {
  const message = err instanceof Error ? err.message : String(err);
  console.error('Error:', message);
  if (err && typeof err === 'object' && 'response' in err) {
    const resp = (err as { response?: { data?: unknown } }).response;
    if (resp?.data) {
      console.error('Details:', JSON.stringify(resp.data, null, 2));
    }
  }
  process.exit(1);
}
