/**
 * Google Picker API integration.
 *
 * Uses Google Identity Services (GIS) for incremental OAuth consent
 * and Google Picker for the native file browser popup.
 */

const PICKER_SCRIPT = 'https://apis.google.com/js/api.js';
const GIS_SCRIPT = 'https://accounts.google.com/gsi/client';
const SCOPE = 'https://www.googleapis.com/auth/drive.readonly';

function getClientId(): string {
  const id = import.meta.env.VITE_GOOGLE_CLIENT_ID;
  if (!id) throw new Error('VITE_GOOGLE_CLIENT_ID not configured');
  return id;
}

// ---- Script loading ----

let pickerLoaded = false;
let gisLoaded = false;

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`)) {
      resolve();
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function ensurePickerApi(): Promise<void> {
  if (pickerLoaded) return;
  await loadScript(PICKER_SCRIPT);
  await new Promise<void>((resolve, reject) => {
    window.gapi.load('picker', { callback: resolve, onerror: reject });
  });
  pickerLoaded = true;
}

async function ensureGis(): Promise<void> {
  if (gisLoaded) return;
  await loadScript(GIS_SCRIPT);
  gisLoaded = true;
}

// ---- Token management ----

let accessToken: string | null = null;
let tokenExpiry = 0;

function isTokenValid(): boolean {
  return !!accessToken && Date.now() < tokenExpiry;
}

function requestToken(): Promise<string> {
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: getClientId(),
      scope: SCOPE,
      callback: (response) => {
        if (response.error) {
          reject(new Error(response.error));
          return;
        }
        accessToken = response.access_token;
        tokenExpiry = Date.now() + response.expires_in * 1000 - 60_000; // 1min buffer
        resolve(response.access_token);
      },
      error_callback: (error) => {
        reject(new Error(error.message || 'OAuth consent failed'));
      },
    });
    client.requestAccessToken();
  });
}

async function getToken(): Promise<string> {
  if (isTokenValid()) return accessToken!;
  return requestToken();
}

// ---- Picker ----

export interface PickerResult {
  docId: string;
  name: string;
  url: string;
}

/**
 * Opens the Google Picker and returns the selected document.
 * Handles script loading, OAuth consent, and Picker lifecycle.
 * Returns null if the user cancels.
 */
export async function openGooglePicker(): Promise<PickerResult | null> {
  await Promise.all([ensurePickerApi(), ensureGis()]);
  const token = await getToken();

  return new Promise((resolve) => {
    const view = new google.picker.DocsView(google.picker.ViewId.DOCUMENTS);
    view.setMimeTypes('application/vnd.google-apps.document');

    const picker = new google.picker.PickerBuilder()
      .setOAuthToken(token)
      .addView(view)
      .setTitle('Select a Google Doc')
      .setOrigin(window.location.origin)
      .setCallback((data) => {
        const action = data[google.picker.Response.ACTION];
        if (action === google.picker.Action.PICKED) {
          picker.dispose();
          const doc = data[google.picker.Response.DOCUMENTS]![0];
          resolve({
            docId: doc[google.picker.Document.ID],
            name: doc[google.picker.Document.NAME],
            url: doc[google.picker.Document.URL],
          });
        } else {
          picker.dispose();
          resolve(null);
        }
      })
      .build();

    picker.setVisible(true);
  });
}
