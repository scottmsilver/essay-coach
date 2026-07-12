/**
 * startEvalRun orchestrator (Eval Cockpit, Task 4).
 *
 * Runs the shared judge panel against real essays: for each essay, generates
 * an incumbent (no prompt override) and a challenger (with the caller-supplied
 * prompt override) analysis, has the panel judge the pair, and gates the
 * aggregate result the same way `eval/panel/panel-gate.ts` does for the CLI
 * (challengerWinRate / feedbackDelta / reliability formulas are replicated
 * verbatim below — see that file for the source of truth).
 *
 * `runEvalCore` is a pure, dependency-injected core so it can be unit tested
 * without Firestore or real model calls (see functions/tests/evalRun.test.ts).
 * `startEvalRun` is the onCall wrapper that wires real deps: auth + admin
 * gate, essay/draft lookup, judge-panel construction from `config/evalPanel`,
 * and Firestore-backed progress/item writes.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { isEmailAdmin } from './admins';
import { buildEvaluationPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';
import { analyzeGrammarWithGemini } from './grammar';
import { analyzeTransitionsWithGemini } from './transitions';
import { makeOpenRouterGenerateJson, type GenerateJsonFn } from './openRouterGenerate';
// NOTE: imported via the `functions/src/shared -> ../../shared` symlink
// (not `../../shared/panel/...`) so that judges/index.ts's third-party SDK
// imports (@anthropic-ai/sdk, openai, @google/genai) resolve against
// functions/node_modules — see functions/src/transitions.ts and
// sentenceSplitter.ts for the same pattern with shared/ modules.
import type { Judge, ReportKind, PairwiseWinner } from './shared/panel/types';
import { runItem } from './shared/panel/run-panel';
import { gateVerdict, DEFAULT_GATE, type GateThresholds } from './shared/panel/metrics';
import { RUBRICS } from './shared/panel/rubrics';
import { buildPanel } from './shared/panel/judges';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const openaiApiKey = defineSecret('OPENAI_API_KEY');
const anthropicApiKey = defineSecret('ANTHROPIC_API_KEY');
const openrouterApiKey = defineSecret('OPENROUTER_API_KEY');

/** Prefix identifying a challengerModelOverride that should run through
 * OpenRouter's OpenAI-compatible API instead of natively via @google/genai —
 * see startEvalRun's wiring and functions/src/openRouterGenerate.ts. */
export const OPENROUTER_MODEL_PREFIX = 'openrouter/';

/**
 * Resolves startEvalRun's OpenRouter wiring: given the raw
 * challengerModelOverride submitted by the caller and the current value of
 * the OPENROUTER_API_KEY secret, decides whether the challenger should run
 * through OpenRouter and, if so, builds its injectable `generateJson` and
 * clears `modelOverride` (an `openrouter/vendor/model` id is never a valid
 * Gemini model id, so it must never reach the native Gemini path).
 *
 * Extracted out of startEvalRun's onCall handler body so this branching +
 * validation logic is directly unit-testable without mocking Firestore/auth
 * (see functions/tests/evalRun.test.ts). Throws HttpsError('failed-precondition')
 * naming OPENROUTER_API_KEY when an openrouter/-prefixed override is
 * requested but the secret is unset/empty.
 */
export function resolveChallengerGeneration(
  challengerModelOverride: string | undefined,
  openrouterKey: string | undefined
): { modelOverride: string | undefined; generateJson?: GenerateJsonFn } {
  if (!challengerModelOverride || !challengerModelOverride.startsWith(OPENROUTER_MODEL_PREFIX)) {
    return { modelOverride: challengerModelOverride };
  }
  if (!openrouterKey) {
    throw new HttpsError(
      'failed-precondition',
      'OPENROUTER_API_KEY secret is not configured — required to run an openrouter/ challenger model.'
    );
  }
  const strippedModel = challengerModelOverride.slice(OPENROUTER_MODEL_PREFIX.length);
  return { modelOverride: undefined, generateJson: makeOpenRouterGenerateJson(openrouterKey, strippedModel) };
}

const MAX_ESSAYS = 20;
const VALID_REPORTS: ReportKind[] = ['overall', 'grammar', 'transitions'];

// Same route-sampling rate as eval/panel/panel-gate.ts's ROUTE_SAMPLE_RATE.
const ROUTE_SAMPLE_RATE = 0.05;

// ── Pure core ────────────────────────────────────────────────────────────

export interface EvalEssayInput {
  id: string;
  content: string;
}

/** The challenger-side overrides passed to `generate()` — any subset may be
 * set. When `generateJson` is present it takes precedence over
 * `modelOverride` for the analyzers (grammar/transitions/overall main
 * generation call): the caller (startEvalRun) is responsible for NOT setting
 * both `generateJson` and a Gemini-path `modelOverride` at once — see
 * makeFirestoreGenerate below. */
export interface ChallengerOverrides {
  promptOverride?: string;
  modelOverride?: string;
  generateJson?: GenerateJsonFn;
}

export interface EvalDeps {
  generate: (report: ReportKind, essay: string, challenger?: ChallengerOverrides) => Promise<{ feedback: string; annotations: string }>;
  judges: Judge[];
  writeProgress: (p: { done: number; total: number; message: string }) => Promise<void>;
  writeItem: (itemId: string, item: EvalItemDoc) => Promise<void>;
  rand?: () => number;
}

export interface EvalRunInput {
  report: ReportKind;
  essays: EvalEssayInput[];
  challengerPromptOverride?: string;
  challengerModelOverride?: string;
  /** Set by startEvalRun when challengerModelOverride is an
   * `openrouter/vendor/model` id — routes the challenger's generation
   * through OpenRouter instead of native Gemini. When this is set,
   * startEvalRun omits challengerModelOverride from this input entirely (it
   * only ever reaches here as the ORIGINAL, prefixed string for display/
   * Firestore config purposes — never as the model fed to the Gemini path). */
  challengerGenerateJson?: GenerateJsonFn;
  thresholds?: GateThresholds;
}

export interface EvalItemDoc {
  essayId: string;
  essayExcerpt: string;
  incumbentFeedback: string;
  challengerFeedback: string;
  weightedMean: Record<'A' | 'B', number>;
  majorityWinner: 'A' | 'B' | 'tie';
  positionBiasFlag: boolean;
  disagreement: boolean;
  perJudgePairwise: PairwiseWinner[];
  failedJudges?: string[];
  routed: boolean;
}

export interface EvalRunVerdict {
  pass: boolean;
  reasons: string[];
  feedbackDelta: number;
  challengerWinRate: number;
  reliability: number;
}

export interface EvalRunResult {
  verdict: EvalRunVerdict;
  failedJudges: string[];
  routedCount: number;
}

/** Max length for the optional, purely-cosmetic challengerLabel field. */
const CHALLENGER_LABEL_MAX_LENGTH = 200;

/** Max length for challengerPromptOverride (mirrored client-side in EvalRunsPage.tsx's Textarea). */
const CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH = 20000;

/**
 * Shape guard for challengerModelOverride — either a bare Gemini model id
 * (e.g. `gemini-3.5-flash`, never interpolated into a path but still worth
 * constraining since it flows into the `@google/genai` SDK call) OR an
 * `openrouter/vendor/model` id (up to 3 total segments, e.g.
 * `openrouter/anthropic/claude-3-opus`) that startEvalRun routes through
 * OpenRouter instead — see OPENROUTER_MODEL_PREFIX. Length is checked
 * separately below rather than folded into the regex, since the segment
 * structure makes an inline `{1,120}` bound awkward to express correctly.
 * Mirrored client-side in EvalRunsPage.tsx's model Autocomplete.
 */
const CHALLENGER_MODEL_OVERRIDE_SHAPE = /^[a-zA-Z0-9._:-]+(\/[a-zA-Z0-9._:-]+){0,2}$/;
const CHALLENGER_MODEL_OVERRIDE_MAX_LENGTH = 120;

/**
 * Shape guard for ids that get interpolated into Firestore doc paths
 * (essayIds here via `users/${uid}/essays/${essayId}`; runId/itemId in
 * recordGoldLabel.ts). Firestore doc path segments containing `/` are
 * silently treated as *additional path segments* rather than literal
 * characters, so an id like `../otherUser` or one embedding a `/` could
 * redirect a lookup to an unintended document. Restricting to
 * `[A-Za-z0-9_-]` — the character set Firestore auto-ids and this app's own
 * ids use — rules that out entirely.
 */
const ID_SHAPE = /^[A-Za-z0-9_-]{1,128}$/;

const EXCERPT_LENGTH = 300;

/** Generic, safe-to-surface message for eval run failures (see sanitizeEvalRunError). */
export const EVAL_RUN_GENERIC_ERROR_MESSAGE = 'Eval run failed — see function logs';

/**
 * Sanitizes an eval-run failure for anything that leaves this process: the
 * `evalRuns/{id}` Firestore doc's errorMessage field and the HttpsError
 * thrown back to the client. SDK errors from the judge panel / analyzers
 * (Gemini, OpenAI, Anthropic) can embed key material in their message — e.g.
 * Gemini's REST errors include the request URL with `?key=<API key>`, and
 * some SDKs echo raw auth headers/bodies in thrown errors — so the *full*
 * error detail must only ever reach logger.error (server-side function
 * logs), mirroring functions/src/submitEssay.ts's generic-message pattern.
 * Callers are responsible for logging the raw error separately; this
 * function never returns any part of it.
 */
export function sanitizeEvalRunError(_error: unknown): string {
  return EVAL_RUN_GENERIC_ERROR_MESSAGE;
}

/**
 * Redacts secret-shaped substrings from an eval-run failure's detail string
 * before it reaches `logger.error` (server-side function logs). Even though
 * this detail never leaves the process (see sanitizeEvalRunError), SDK
 * errors from the judge panel / analyzers can embed live key material —
 * Gemini's REST errors put the API key in the request URL's `?key=` query
 * param, and some SDKs echo raw `Authorization` headers or `api_key` fields
 * in thrown error messages — and logs are a lower-trust boundary than
 * in-memory error objects (broader retention, wider read access, more
 * exporters). Redacting here keeps that material out of logs even though
 * clients/Firestore never see the raw detail at all.
 */
export function redactEvalError(detail: string): string {
  return detail
    .replace(/([?&]key=)[^&\s]+/gi, '$1[REDACTED]')
    .replace(/(sk-[A-Za-z0-9_-]{8,})/g, '[REDACTED]')
    .replace(/(AIza[A-Za-z0-9_-]{10,})/g, '[REDACTED]')
    .replace(/(authorization\s*[:=]\s*)\S+/gi, '$1[REDACTED]')
    .replace(/(api[-_]?key\s*[:=]\s*)\S+/gi, '$1[REDACTED]');
}

/**
 * Validates a startEvalRun request. Throws a plain Error naming the specific
 * rule violated (report enum / 1..20 essay cap / non-empty override) so both
 * the pure-core tests and the onCall wrapper (which wraps this in an
 * HttpsError) get an actionable message.
 */
export function validateEvalInput(input: {
  report: unknown;
  essays: unknown[];
  challengerPromptOverride?: unknown;
  challengerModelOverride?: unknown;
  challengerLabel?: unknown;
}): void {
  if (typeof input.report !== 'string' || !VALID_REPORTS.includes(input.report as ReportKind)) {
    throw new Error(`Invalid report kind: ${String(input.report)}. Must be one of ${VALID_REPORTS.join(', ')}.`);
  }
  if (!Array.isArray(input.essays) || input.essays.length < 1) {
    throw new Error('At least 1 essay is required to start an eval run.');
  }
  if (input.essays.length > MAX_ESSAYS) {
    throw new Error(`Too many essays: ${input.essays.length}. The maximum is ${MAX_ESSAYS} essays per run.`);
  }

  const { challengerPromptOverride, challengerModelOverride } = input;

  if (challengerPromptOverride !== undefined) {
    if (typeof challengerPromptOverride !== 'string') {
      throw new Error(`challengerPromptOverride must be a string if provided, got ${typeof challengerPromptOverride}.`);
    }
    if (challengerPromptOverride.length > CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH) {
      throw new Error(`challengerPromptOverride must be at most ${CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH} characters.`);
    }
  }
  if (challengerModelOverride !== undefined) {
    if (typeof challengerModelOverride !== 'string') {
      throw new Error(`challengerModelOverride must be a string if provided, got ${typeof challengerModelOverride}.`);
    }
    if (challengerModelOverride.length > 0 && challengerModelOverride.length > CHALLENGER_MODEL_OVERRIDE_MAX_LENGTH) {
      throw new Error(
        `challengerModelOverride must be at most ${CHALLENGER_MODEL_OVERRIDE_MAX_LENGTH} characters.`
      );
    }
    if (challengerModelOverride.length > 0 && !CHALLENGER_MODEL_OVERRIDE_SHAPE.test(challengerModelOverride)) {
      throw new Error(
        `challengerModelOverride must match ${CHALLENGER_MODEL_OVERRIDE_SHAPE} (letters, numbers, '.', '_', ':', '-', up to 3 '/'-separated segments; max ${CHALLENGER_MODEL_OVERRIDE_MAX_LENGTH} characters).`
      );
    }
  }

  const hasPromptOverride = typeof challengerPromptOverride === 'string' && challengerPromptOverride.trim().length > 0;
  const hasModelOverride = typeof challengerModelOverride === 'string' && challengerModelOverride.trim().length > 0;
  if (!hasPromptOverride && !hasModelOverride) {
    throw new Error('Provide a challenger prompt override, a challenger model override, or both.');
  }

  input.essays.forEach((essayId, index) => {
    if (typeof essayId !== 'string') {
      throw new Error(`Invalid essay id at index ${index}: expected a string, got ${typeof essayId}.`);
    }
    if (!ID_SHAPE.test(essayId)) {
      throw new Error(`Invalid essay id at index ${index}: must match ${ID_SHAPE}.`);
    }
  });
  if (input.challengerLabel !== undefined) {
    if (typeof input.challengerLabel !== 'string') {
      throw new Error(`challengerLabel must be a string if provided, got ${typeof input.challengerLabel}.`);
    }
    if (input.challengerLabel.length > CHALLENGER_LABEL_MAX_LENGTH) {
      throw new Error(`challengerLabel must be at most ${CHALLENGER_LABEL_MAX_LENGTH} characters.`);
    }
  }
}

export async function runEvalCore(deps: EvalDeps, input: EvalRunInput): Promise<EvalRunResult> {
  const { report, essays, challengerPromptOverride, challengerModelOverride, challengerGenerateJson } = input;
  const rand = deps.rand ?? Math.random;
  const total = essays.length;
  const failedJudgesSet = new Set<string>();
  const perItem: Awaited<ReturnType<typeof runItem>>[] = [];
  let routedCount = 0;
  const challengerOverrides: ChallengerOverrides = {
    promptOverride: challengerPromptOverride,
    modelOverride: challengerModelOverride,
    ...(challengerGenerateJson ? { generateJson: challengerGenerateJson } : {}),
  };

  await deps.writeProgress({ done: 0, total, message: `Starting eval run over ${total} essay(s)...` });

  for (let i = 0; i < essays.length; i++) {
    const essay = essays[i];

    // deps.generate is called incumbent-then-challenger per essay here, but
    // no implementation of generate() (see makeFirestoreGenerate below) may
    // rely on that order or call count — it must resolve any per-essay
    // context solely from the (report, essayContent, challenger) arguments it
    // receives on each call. Incumbent gets no third argument at all (not
    // even an empty object) so implementations can distinguish "incumbent,
    // no overrides" from "challenger, overrides present but both fields
    // undefined" — though validateEvalInput guarantees the latter never
    // actually happens with both fields empty.
    const incumbent = await deps.generate(report, essay.content);
    const challenger = await deps.generate(report, essay.content, challengerOverrides);

    const verdict = await runItem({
      report,
      judges: deps.judges,
      essay: essay.content,
      feedbackA: incumbent.feedback,
      annotationsA: incumbent.annotations,
      feedbackB: challenger.feedback,
      annotationsB: challenger.annotations,
    });

    if (verdict.failedJudges) {
      for (const id of verdict.failedJudges) failedJudgesSet.add(id);
    }

    const routed = verdict.disagreement || verdict.positionBiasFlag || rand() < ROUTE_SAMPLE_RATE;
    if (routed) routedCount++;

    const itemDoc: EvalItemDoc = {
      essayId: essay.id,
      essayExcerpt: essay.content.slice(0, EXCERPT_LENGTH),
      incumbentFeedback: incumbent.feedback,
      challengerFeedback: challenger.feedback,
      weightedMean: verdict.weightedMean,
      majorityWinner: verdict.majorityWinner,
      positionBiasFlag: verdict.positionBiasFlag,
      disagreement: verdict.disagreement,
      perJudgePairwise: verdict.perJudgePairwise,
      routed,
      ...(verdict.failedJudges ? { failedJudges: verdict.failedJudges } : {}),
    };

    await deps.writeItem(essay.id, itemDoc);
    perItem.push(verdict);

    await deps.writeProgress({
      done: i + 1,
      total,
      message: `Evaluated ${i + 1} of ${total} essay(s)`,
    });
  }

  // The following three metrics + gate call replicate eval/panel/panel-gate.ts's
  // runGate formulas exactly, so in-app runs and the CLI panel:gate command
  // agree on what "pass" means for the same data.

  // challenger (side B) win rate: matches run-judge.ts's "wins + ties count
  // toward the challenger" convention, since a tie means the challenger held
  // its own against the incumbent rather than losing outright.
  const winOrTieCount = perItem.filter((v) => v.majorityWinner === 'B' || v.majorityWinner === 'tie').length;
  const challengerWinRate = perItem.length > 0 ? winOrTieCount / perItem.length : 0;

  const meanA = perItem.length > 0 ? perItem.reduce((sum, v) => sum + v.weightedMean.A, 0) / perItem.length : 0;
  const meanB = perItem.length > 0 ? perItem.reduce((sum, v) => sum + v.weightedMean.B, 0) / perItem.length : 0;
  const feedbackDelta = Math.abs(meanA - meanB);

  // Reliability v1 stand-in: fraction of items where the panel did NOT flag
  // internal disagreement, i.e. panel self-consistency on a single pass.
  // This is a placeholder for true reliability, which would rerun a sample
  // of items and measure agreement between runs (see RELIABILITY_SAMPLE_RATE
  // in run-judge.ts for the rerun-based approach used elsewhere).
  const reliability = perItem.length > 0 ? perItem.filter((v) => !v.disagreement).length / perItem.length : 1;

  const gate = gateVerdict({ feedbackDelta, challengerWinRate, reliability }, input.thresholds ?? DEFAULT_GATE);

  // Persist the raw metric values alongside the pass/reasons gate verdict —
  // downstream consumers (evalRuns/{id}.verdict, EvalRunDetailPage.tsx) need
  // the actual numbers even on a passing run, when `reasons` is empty and
  // carries no numeric detail (gateVerdict only embeds a value in `reasons`
  // when a threshold is violated).
  const verdict: EvalRunVerdict = { ...gate, feedbackDelta, challengerWinRate, reliability };

  return { verdict, failedJudges: Array.from(failedJudgesSet), routedCount };
}

// ── Firestore-backed generate() ─────────────────────────────────────────

export interface EssayWithMeta extends EvalEssayInput {
  assignmentPrompt: string;
  writingType: string;
}

/**
 * Builds the `generate` dep that calls the real Task-3 analyzers.
 *
 * Recovers per-essay metadata (assignmentPrompt/writingType, needed only by
 * the 'overall' analyzer) by looking it up from the essay *content* the
 * closure is called with, rather than from a call-order/index cursor. This
 * is deliberately independent of how many times or in what order
 * runEvalCore calls generate() per essay — see the comment at that call
 * site. Edge case: two essays/drafts with byte-identical content will share
 * metadata (whichever was inserted into the Map); acceptable for eval runs,
 * which only use this metadata to build the prompt, not to identify essays.
 */
export function makeFirestoreGenerate(params: {
  report: ReportKind;
  essays: EssayWithMeta[];
  apiKey: string;
}): EvalDeps['generate'] {
  const { report, essays, apiKey } = params;
  const metaByContent = new Map<string, EssayWithMeta>(essays.map((e) => [e.content, e]));

  return async (_report, essayContent, challenger) => {
    // grammar/transitions accept all three overrides through their own
    // widened `opts` (systemPromptOverride + modelOverride + generateJson —
    // see analyzeGrammarWithGemini / analyzeTransitionsWithGemini). 'overall'
    // below routes modelOverride through evaluateWithGemini's existing
    // dedicated `model` parameter instead, rather than growing a second,
    // competing override mechanism — but generateJson still flows through
    // its opts object like the other two analyzers.
    //
    // When generateJson is present, it takes precedence over modelOverride:
    // the challenger's generation is fully delegated to the injected
    // function (e.g. OpenRouter — see openRouterGenerate.ts), so modelOverride
    // (which may hold an `openrouter/vendor/model` id, not a valid Gemini
    // model) must never also be threaded down the native Gemini path.
    const usingGenerateJson = !!challenger?.generateJson;
    const opts = challenger
      ? {
          systemPromptOverride: challenger.promptOverride,
          modelOverride: usingGenerateJson ? undefined : challenger.modelOverride,
          generateJson: challenger.generateJson,
        }
      : undefined;

    if (report === 'grammar') {
      const analysis = await analyzeGrammarWithGemini(apiKey, essayContent, undefined, opts);
      return { feedback: JSON.stringify(analysis, null, 2), annotations: '[]' };
    }

    if (report === 'transitions') {
      const analysis = await analyzeTransitionsWithGemini(apiKey, essayContent, undefined, null, opts);
      return { feedback: JSON.stringify(analysis, null, 2), annotations: '[]' };
    }

    // 'overall'
    const essay = metaByContent.get(essayContent);
    if (!essay) {
      throw new Error(
        'makeFirestoreGenerate: no essay metadata found for the given content. The generate() closure is keyed ' +
          'by essay content, so this indicates the content passed in does not match any loaded essay.'
      );
    }
    const prompt = buildEvaluationPrompt({
      assignmentPrompt: essay.assignmentPrompt,
      writingType: essay.writingType,
      content: essayContent,
    });
    const analysis = await evaluateWithGemini(
      apiKey,
      prompt,
      undefined,
      usingGenerateJson ? undefined : challenger?.modelOverride,
      opts ? { systemPromptOverride: opts.systemPromptOverride, generateJson: opts.generateJson } : undefined
    );
    return { feedback: JSON.stringify(analysis, null, 2), annotations: extractOverallAnnotations(analysis) };
  };
}

/** Flattens each trait's annotations array into one JSON array, tagged with the trait name. */
function extractOverallAnnotations(analysis: Record<string, unknown>): string {
  const traits = (analysis.traits ?? {}) as Record<string, { annotations?: unknown[] }>;
  const all: unknown[] = [];
  for (const [trait, t] of Object.entries(traits)) {
    for (const annotation of t?.annotations ?? []) {
      all.push({ trait, ...(annotation as object) });
    }
  }
  return JSON.stringify(all);
}

// ── onCall wrapper ───────────────────────────────────────────────────────

interface EvalPanelConfig {
  anthropicModel: string;
  openaiModel: string;
  geminiModel: string;
}

async function loadEvalPanelConfig(db: FirebaseFirestore.Firestore): Promise<EvalPanelConfig> {
  const doc = await db.doc('config/evalPanel').get();
  if (!doc.exists) {
    throw new HttpsError('failed-precondition', 'config/evalPanel document is missing. Create it with anthropicModel, openaiModel, and geminiModel fields.');
  }
  const data = doc.data() ?? {};
  for (const field of ['anthropicModel', 'openaiModel', 'geminiModel'] as const) {
    if (typeof data[field] !== 'string' || data[field].length === 0) {
      throw new HttpsError('failed-precondition', `config/evalPanel.${field} is required and must be a non-empty string.`);
    }
  }
  return {
    anthropicModel: data.anthropicModel,
    openaiModel: data.openaiModel,
    geminiModel: data.geminiModel,
  };
}

export const startEvalRun = onCall(
  {
    timeoutSeconds: 1800,
    memory: '1GiB',
    secrets: [geminiApiKey, openaiApiKey, anthropicApiKey, openrouterApiKey],
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

    const { report, essayIds, challengerPromptOverride, challengerModelOverride, challengerLabel } = request.data ?? {};

    try {
      validateEvalInput({ report, essays: essayIds, challengerPromptOverride, challengerModelOverride, challengerLabel });
    } catch (err) {
      throw new HttpsError('invalid-argument', err instanceof Error ? err.message : String(err));
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    const essays: EssayWithMeta[] = [];
    for (const essayId of essayIds as string[]) {
      const essayRef = db.doc(`users/${uid}/essays/${essayId}`);
      const essayDoc = await essayRef.get();
      if (!essayDoc.exists) {
        throw new HttpsError('not-found', `Essay ${essayId} not found`);
      }
      const essayData = essayDoc.data()!;
      const { assignmentPrompt, writingType, currentDraftNumber } = essayData;

      const draftSnapshot = await essayRef
        .collection('drafts')
        .where('draftNumber', '==', currentDraftNumber)
        .limit(1)
        .get();
      if (draftSnapshot.empty) {
        throw new HttpsError('not-found', `Current draft for essay ${essayId} not found`);
      }
      const content = draftSnapshot.docs[0].data().content;
      if (!content) {
        throw new HttpsError('invalid-argument', `Essay ${essayId}'s current draft has no content`);
      }

      essays.push({ id: essayId, content, assignmentPrompt: assignmentPrompt ?? '', writingType: writingType ?? '' });
    }

    const cfg = await loadEvalPanelConfig(db);

    const env = {
      ANTHROPIC_API_KEY: anthropicApiKey.value(),
      OPENAI_API_KEY: openaiApiKey.value(),
      GEMINI_API_KEY: geminiApiKey.value(),
      PANEL_ANTHROPIC_MODEL: cfg.anthropicModel,
      PANEL_OPENAI_MODEL: cfg.openaiModel,
      PANEL_GEMINI_MODEL: cfg.geminiModel,
    } as NodeJS.ProcessEnv;

    const judges = buildPanel(env, RUBRICS[report as ReportKind].dimensions);

    const runRef = db.collection('evalRuns').doc();
    await runRef.set({
      report,
      essayIds,
      config: {
        challengerPromptOverride: typeof challengerPromptOverride === 'string' ? challengerPromptOverride : '',
        challengerModelOverride: typeof challengerModelOverride === 'string' ? challengerModelOverride : '',
        challengerLabel: typeof challengerLabel === 'string' ? challengerLabel : '',
      },
      status: 'generating',
      createdBy: email,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      progress: { done: 0, total: essays.length, message: 'Starting...' },
    });

    // Status transitions generating -> judging -> complete/error. Generation
    // and judging are interleaved per-essay (see runEvalCore's loop), so we
    // flip to 'judging' the first time an item is written — i.e. once the
    // first essay has been generated AND judged — and leave it there for the
    // rest of the run.
    let judgingStarted = false;

    const generate = makeFirestoreGenerate({ report: report as ReportKind, essays, apiKey: geminiApiKey.value() });

    // When challengerModelOverride is an `openrouter/vendor/model` id, the
    // challenger's generation runs through OpenRouter instead of native
    // Gemini. The ORIGINAL (prefixed) challengerModelOverride is still what
    // gets persisted to the run doc's config below, so the UI can keep
    // showing what was actually requested.
    const { modelOverride: challengerModelOverrideForCore, generateJson: challengerGenerateJson } =
      resolveChallengerGeneration(
        typeof challengerModelOverride === 'string' ? challengerModelOverride : undefined,
        openrouterApiKey.value()
      );

    try {
      const result = await runEvalCore(
        {
          generate,
          judges,
          writeProgress: async (p) => {
            await runRef.update({ progress: p, updatedAt: FieldValue.serverTimestamp() });
          },
          writeItem: async (itemId, item) => {
            if (!judgingStarted) {
              judgingStarted = true;
              await runRef.update({ status: 'judging', updatedAt: FieldValue.serverTimestamp() });
            }
            await runRef.collection('items').doc(itemId).set(item);
          },
        },
        {
          report: report as ReportKind,
          essays: essays.map(({ id, content }) => ({ id, content })),
          challengerPromptOverride,
          challengerModelOverride: challengerModelOverrideForCore,
          challengerGenerateJson,
        }
      );

      await runRef.update({
        status: 'complete',
        verdict: result.verdict,
        failedJudges: result.failedJudges,
        routedCount: result.routedCount,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { runId: runRef.id };
    } catch (error: unknown) {
      // Full detail (which may embed API key material — see
      // sanitizeEvalRunError) goes to server logs only. The Firestore doc
      // and the HttpsError returned to the client get a generic message.
      const detail = error instanceof Error ? error.message : String(error);
      logger.error('startEvalRun failed', { error: redactEvalError(detail) });
      const safeMessage = sanitizeEvalRunError(error);
      await runRef.update({
        status: 'error',
        errorMessage: safeMessage,
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new HttpsError('internal', safeMessage);
    }
  }
);
