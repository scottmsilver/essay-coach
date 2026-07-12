/**
 * OpenRouter-backed GenerateJsonFn (Eval Cockpit, OpenRouter challenger support).
 *
 * Lets the eval cockpit run a challenger generator through ANY model
 * OpenRouter exposes (Anthropic, OpenAI, Llama, Mistral, etc.) via its
 * OpenAI-compatible chat/completions endpoint, while the production analyzer
 * pipeline (prompts, schemas, transitions recheck) stays completely
 * unchanged — see grammar.ts / transitions.ts / gemini.ts's `generateJson`
 * injection point.
 *
 * We hit the REST endpoint directly with `fetch` rather than pulling in an
 * OpenAI-compatible SDK: the surface we need (one system + one user message,
 * a JSON response) is small enough that a raw POST is simpler than wiring up
 * a second SDK's client/config surface alongside @google/genai.
 */

const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';
const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [1000, 2000, 4000];

export type GenerateJsonFn = (opts: {
  contents: string;
  systemInstruction: string;
  responseSchema: object;
}) => Promise<string>;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Extracts the first `{...}` JSON object from a raw model response and
 * validates that it parses — mirrors shared/panel/judges/parse.ts's
 * `/\{[\s\S]*\}/` idiom, since OpenRouter models (like judge models) often
 * wrap JSON in prose or markdown fences despite instructions not to. Throws
 * a plain Error (never including the API key) on no-match or invalid JSON —
 * callers retry on this. */
function extractAndValidateJson(raw: string): string {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error('OpenRouter response contained no JSON object');
  }
  // Validate it parses; the caller receives the extracted STRING (not the
  // parsed value) and parses it again itself, per the design contract.
  JSON.parse(match[0]);
  return match[0];
}

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

/**
 * Builds a `GenerateJsonFn` backed by OpenRouter's chat/completions endpoint
 * for the given model (already stripped of the `openrouter/` prefix by the
 * caller — see evalRun.ts's startEvalRun).
 */
export function makeOpenRouterGenerateJson(apiKey: string, model: string): GenerateJsonFn {
  return async (opts) => {
    let lastError: unknown;
    let useResponseFormat = true;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const systemContent =
          opts.systemInstruction +
          '\n\nRespond ONLY with a JSON object matching this JSON schema:\n' +
          JSON.stringify(opts.responseSchema);

        const body: Record<string, unknown> = {
          model,
          messages: [
            { role: 'system', content: systemContent },
            { role: 'user', content: opts.contents },
          ],
        };
        if (useResponseFormat) {
          body.response_format = { type: 'json_object' };
        }

        const res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        });

        if (!res.ok) {
          const bodyText = await res.text().catch(() => '');
          // Some OpenRouter-routed models 4xx when response_format is set
          // (it isn't supported by every upstream). Fall back to relying on
          // the schema instruction in the system message alone, on THIS same
          // attempt (a fresh call re-samples the model either way, so this
          // doesn't cost an extra retry slot).
          if (useResponseFormat && res.status >= 400 && res.status < 500 && /response_format/i.test(bodyText)) {
            useResponseFormat = false;
            attempt--; // retry immediately without consuming a backoff slot
            continue;
          }
          throw new Error(`OpenRouter request failed with status ${res.status}: ${bodyText.slice(0, 500)}`);
        }

        let data: ChatCompletionResponse;
        try {
          data = await res.json();
        } catch {
          throw new Error('OpenRouter returned an invalid JSON response body');
        }

        const content = data.choices?.[0]?.message?.content;
        if (!content) {
          throw new Error('OpenRouter response contained no message content');
        }

        return extractAndValidateJson(content);
      } catch (err) {
        lastError = err;
        if (attempt < MAX_RETRIES - 1) {
          await sleep(RETRY_DELAYS_MS[attempt]);
        }
      }
    }

    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    // Never include the API key in the thrown message — it's never
    // interpolated into `detail` above (it only ever appears in the
    // Authorization header, not in any error text we construct or in
    // upstream error bodies we've observed), but redact defensively anyway
    // in case an upstream error body ever echoes it back.
    const safeDetail = detail.replace(new RegExp(apiKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'), '[REDACTED]');
    throw new Error(`OpenRouter generation failed after ${MAX_RETRIES} attempts: ${safeDetail}`);
  };
}
