/**
 * listEvalModels onCall (Eval Cockpit).
 *
 * Lets an admin discover which models are actually available to run as an
 * eval challenger — both native Gemini models (via the project's
 * GEMINI_API_KEY) and, additionally, any model OpenRouter exposes (via the
 * optional OPENROUTER_API_KEY secret) — so the Challenger model field in
 * EvalRunsPage.tsx can be a searchable picker instead of a blind free-text
 * box. Read-only — no Firestore writes, same auth + allowlist + admin gate
 * as startEvalRun / recordGoldLabel.
 *
 * Calls the Generative Language REST API's models.list endpoint directly
 * (there's no listModels() on the @google/genai SDK surface this codebase
 * already depends on for evaluateWithGemini, so this mirrors gdocResolver.ts's
 * plain-fetch pattern rather than pulling in a second SDK), plus OpenRouter's
 * own models.list REST endpoint for the openrouter/ entries.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { isEmailAdmin } from './admins';
import { redactEvalError, OPENROUTER_MODEL_PREFIX } from './evalRun';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const openrouterApiKey = defineSecret('OPENROUTER_API_KEY');

const MODELS_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta/models';
const PAGE_SIZE = 200;
const MAX_PAGES = 3;

const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models';
/** Bound on how many OpenRouter entries we merge in, so the Autocomplete
 * dropdown (and this function's response payload) stays a manageable size
 * even as OpenRouter's catalog grows. */
const MAX_OPENROUTER_MODELS = 400;

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

interface OpenRouterModel {
  id?: string;
}

interface OpenRouterModelsResponse {
  data?: OpenRouterModel[];
}

/**
 * Fetches OpenRouter's model catalog and maps each id to an
 * `openrouter/<id>` challenger-model string. Best-effort and silent: if the
 * OPENROUTER_API_KEY secret is unset (empty string), this is a convenience
 * feature the eval cockpit can simply do without, so we skip the fetch
 * entirely rather than erroring the whole listEvalModels call. A real
 * request failure (non-2xx, network error, bad JSON) still throws — that
 * path is caught by the caller's existing try/catch alongside the Gemini
 * fetch, and redacted/logged the same way.
 */
async function fetchOpenRouterModels(apiKey: string): Promise<string[]> {
  if (!apiKey) return [];

  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok) {
    const bodyText = await res.text().catch(() => '');
    throw new Error(`OpenRouter models.list failed with status ${res.status}: ${bodyText.slice(0, 500)}`);
  }

  let data: OpenRouterModelsResponse;
  try {
    data = await res.json();
  } catch {
    throw new Error('OpenRouter models.list returned an invalid JSON response');
  }

  const ids = (data.data ?? [])
    .map((m) => m.id)
    .filter((id): id is string => typeof id === 'string' && id.length > 0);
  const uniqueIds = Array.from(new Set(ids));
  return uniqueIds.slice(0, MAX_OPENROUTER_MODELS).map((id) => `${OPENROUTER_MODEL_PREFIX}${id}`);
}

export const listEvalModels = onCall(
  {
    timeoutSeconds: 30,
    secrets: [geminiApiKey, openrouterApiKey],
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
      const geminiModels = Array.from(names).sort();

      const openrouterModels = (await fetchOpenRouterModels(openrouterApiKey.value())).sort();

      // Gemini-native models first, then openrouter/ entries — see
      // EvalRunsPage.tsx's Autocomplete, which relies on this ordering to
      // keep the production model family at the top of the dropdown. Wrapped
      // in a Set for a final dedupe pass (order-preserving) even though the
      // two source lists can never overlap by prefix.
      return { models: Array.from(new Set([...geminiModels, ...openrouterModels])) };
    } catch (error: unknown) {
      // Full detail (which embeds the API key in the request URL's `?key=`
      // param, or in an Authorization header for OpenRouter — see
      // fetchAllModels / fetchOpenRouterModels) goes to server logs only,
      // and only after redaction. The HttpsError returned to the client is
      // always generic.
      const detail = error instanceof Error ? error.message : String(error);
      logger.error('listEvalModels failed', { error: redactEvalError(detail) });
      throw new HttpsError('unavailable', GENERIC_UPSTREAM_ERROR);
    }
  }
);
