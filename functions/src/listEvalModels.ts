/**
 * listEvalModels onCall (Eval Cockpit).
 *
 * Lets an admin discover which Gemini models are actually available to the
 * project's GEMINI_API_KEY, so the Challenger model field in EvalRunsPage.tsx
 * can be a searchable picker instead of a blind free-text box. Read-only —
 * no Firestore writes, same auth + allowlist + admin gate as startEvalRun /
 * recordGoldLabel.
 *
 * Calls the Generative Language REST API's models.list endpoint directly
 * (there's no listModels() on the @google/genai SDK surface this codebase
 * already depends on for evaluateWithGemini, so this mirrors gdocResolver.ts's
 * plain-fetch pattern rather than pulling in a second SDK).
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { isEmailAdmin } from './admins';
import { redactEvalError } from './evalRun';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

const MODELS_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const PAGE_SIZE = 200;
const MAX_PAGES = 3;

/** Generic, safe-to-surface message — never echoes the upstream URL or key (see redactEvalError). */
const GENERIC_UPSTREAM_ERROR = 'Could not list available models — see function logs';

interface GenerativeLanguageModel {
  name?: string;
  supportedGenerationMethods?: string[];
}

interface GenerativeLanguageModelsResponse {
  models?: GenerativeLanguageModel[];
  nextPageToken?: string;
}

/**
 * Fetches up to MAX_PAGES pages of models.list, following nextPageToken.
 * Throws a plain Error on any non-ok response or malformed JSON — callers
 * are responsible for redacting the key out of that error before logging it
 * (the URL embeds `?key=<apiKey>`) and for never surfacing it to the client.
 */
async function fetchAllModels(apiKey: string): Promise<GenerativeLanguageModel[]> {
  const all: GenerativeLanguageModel[] = [];
  let pageToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({ pageSize: String(PAGE_SIZE), key: apiKey });
    if (pageToken) params.set('pageToken', pageToken);
    const url = `${MODELS_BASE_URL}?${params}`;

    const res = await fetch(url);
    if (!res.ok) {
      const bodyText = await res.text().catch(() => '');
      throw new Error(`models.list failed with status ${res.status}: ${bodyText.slice(0, 500)}`);
    }

    let data: GenerativeLanguageModelsResponse;
    try {
      data = await res.json();
    } catch {
      throw new Error('models.list returned an invalid JSON response');
    }

    all.push(...(data.models ?? []));

    if (!data.nextPageToken) break;
    pageToken = data.nextPageToken;
  }

  return all;
}

export const listEvalModels = onCall(
  {
    timeoutSeconds: 30,
    secrets: [geminiApiKey],
  },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }
    if (!(await isEmailAdmin(email))) {
      throw new HttpsError('permission-denied', 'This action requires admin access');
    }

    try {
      const models = await fetchAllModels(geminiApiKey.value());

      const names = new Set<string>();
      for (const model of models) {
        if (!model.name || !model.supportedGenerationMethods?.includes('generateContent')) continue;
        names.add(model.name.startsWith('models/') ? model.name.slice('models/'.length) : model.name);
      }

      return { models: Array.from(names).sort() };
    } catch (error: unknown) {
      // Full detail (which embeds the API key in the request URL's `?key=`
      // param — see fetchAllModels) goes to server logs only, and only after
      // redaction. The HttpsError returned to the client is always generic.
      const detail = error instanceof Error ? error.message : String(error);
      logger.error('listEvalModels failed', { error: redactEvalError(detail) });
      throw new HttpsError('unavailable', GENERIC_UPSTREAM_ERROR);
    }
  }
);
