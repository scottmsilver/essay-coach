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

const MAX_ESSAYS = 20;
const VALID_REPORTS: ReportKind[] = ['overall', 'grammar', 'transitions'];

// Same route-sampling rate as eval/panel/panel-gate.ts's ROUTE_SAMPLE_RATE.
const ROUTE_SAMPLE_RATE = 0.05;

// ── Pure core ────────────────────────────────────────────────────────────

export interface EvalEssayInput {
  id: string;
  content: string;
}

export interface EvalDeps {
  generate: (report: ReportKind, essay: string, override?: string) => Promise<{ feedback: string; annotations: string }>;
  judges: Judge[];
  writeProgress: (p: { done: number; total: number; message: string }) => Promise<void>;
  writeItem: (itemId: string, item: EvalItemDoc) => Promise<void>;
  rand?: () => number;
}

export interface EvalRunInput {
  report: ReportKind;
  essays: EvalEssayInput[];
  challengerPromptOverride: string;
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

export interface EvalRunResult {
  verdict: { pass: boolean; reasons: string[] };
  failedJudges: string[];
  routedCount: number;
}

const EXCERPT_LENGTH = 300;

/**
 * Validates a startEvalRun request. Throws a plain Error naming the specific
 * rule violated (report enum / 1..20 essay cap / non-empty override) so both
 * the pure-core tests and the onCall wrapper (which wraps this in an
 * HttpsError) get an actionable message.
 */
export function validateEvalInput(input: {
  report: unknown;
  essays: unknown[];
  challengerPromptOverride: unknown;
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
  if (typeof input.challengerPromptOverride !== 'string' || input.challengerPromptOverride.trim().length === 0) {
    throw new Error('challengerPromptOverride must be a non-empty string.');
  }
}

export async function runEvalCore(deps: EvalDeps, input: EvalRunInput): Promise<EvalRunResult> {
  const { report, essays, challengerPromptOverride } = input;
  const rand = deps.rand ?? Math.random;
  const total = essays.length;
  const failedJudgesSet = new Set<string>();
  const perItem: Awaited<ReturnType<typeof runItem>>[] = [];
  let routedCount = 0;

  await deps.writeProgress({ done: 0, total, message: `Starting eval run over ${total} essay(s)...` });

  for (let i = 0; i < essays.length; i++) {
    const essay = essays[i];

    const incumbent = await deps.generate(report, essay.content);
    const challenger = await deps.generate(report, essay.content, challengerPromptOverride);

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

  const verdict = gateVerdict({ feedbackDelta, challengerWinRate, reliability }, input.thresholds ?? DEFAULT_GATE);

  return { verdict, failedJudges: Array.from(failedJudgesSet), routedCount };
}

// ── Firestore-backed generate() ─────────────────────────────────────────

interface EssayWithMeta extends EvalEssayInput {
  assignmentPrompt: string;
  writingType: string;
}

/**
 * Builds the `generate` dep that calls the real Task-3 analyzers.
 *
 * runEvalCore calls `generate()` exactly twice per essay, in essay order
 * (incumbent then challenger), before moving to the next essay — see the
 * loop above. That fixed, documented calling contract (both this closure and
 * runEvalCore live in this file) lets us recover per-essay metadata
 * (assignmentPrompt/writingType, needed only by the 'overall' analyzer)
 * without changing the generate() signature specified by the plan, which
 * takes only the essay content string.
 */
function makeFirestoreGenerate(params: {
  report: ReportKind;
  essays: EssayWithMeta[];
  apiKey: string;
}): EvalDeps['generate'] {
  const { report, essays, apiKey } = params;
  let callIndex = 0;

  return async (_report, essayContent, override) => {
    const essayIndex = Math.floor(callIndex / 2);
    callIndex++;
    const essay = essays[essayIndex];
    const opts = override ? { systemPromptOverride: override } : undefined;

    if (report === 'grammar') {
      const analysis = await analyzeGrammarWithGemini(apiKey, essayContent, undefined, opts);
      return { feedback: JSON.stringify(analysis, null, 2), annotations: '[]' };
    }

    if (report === 'transitions') {
      const analysis = await analyzeTransitionsWithGemini(apiKey, essayContent, undefined, null, opts);
      return { feedback: JSON.stringify(analysis, null, 2), annotations: '[]' };
    }

    // 'overall'
    const prompt = buildEvaluationPrompt({
      assignmentPrompt: essay.assignmentPrompt,
      writingType: essay.writingType,
      content: essayContent,
    });
    const analysis = await evaluateWithGemini(apiKey, prompt, undefined, undefined, opts);
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
    secrets: [geminiApiKey, openaiApiKey, anthropicApiKey],
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

    const { report, essayIds, challengerPromptOverride } = request.data ?? {};

    try {
      validateEvalInput({ report, essays: essayIds, challengerPromptOverride });
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
      challengerPromptOverride,
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
      const message = error instanceof Error ? error.message : String(error);
      logger.error('startEvalRun failed', { error: message });
      await runRef.update({
        status: 'error',
        errorMessage: message,
        updatedAt: FieldValue.serverTimestamp(),
      });
      throw new HttpsError('internal', `Eval run failed: ${message}`);
    }
  }
);
