/**
 * Factory for creating Firebase callable analysis handlers.
 *
 * All four analysis types (grammar, transitions, prompt adherence, evaluation)
 * share the same scaffolding: auth check, allowlist gate, draft lookup, Gemini
 * call with SyntaxError retry, and Firestore status/result writes. This factory
 * extracts that scaffolding so each handler is just a config object.
 *
 * Flow:
 *   1. Auth + allowlist check
 *   2. Resolve essay owner (supports shared access via ownerUid)
 *   3. Load draft from Firestore
 *   4. Run the analysis function (provided by config)
 *   5. On success: write result to dataField, clear statusField
 *   6. On SyntaxError: retry once (Gemini occasionally returns malformed JSON)
 *   7. On failure: write error to statusField, throw HttpsError
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { resolveEssayOwner } from './resolveEssayOwner';
import type { DocumentReference } from 'firebase-admin/firestore';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

/** Everything an analysis function needs to do its work. */
export interface AnalysisContext {
  apiKey: string;
  content: string;
  draftRef: DocumentReference;
  /** Raw Firestore draft data, for handlers that need extra fields (e.g., draftNumber, evaluation) */
  draftData: FirebaseFirestore.DocumentData;
  essayId: string;
  /** Raw request.data from the client, for handler-specific flags (e.g., force) */
  requestData: Record<string, unknown>;
}

/** All analysis functions take a context and return a result. */
export type AnalysisFn<T> = (ctx: AnalysisContext) => Promise<T>;

export interface AnalysisHandlerConfig<T> {
  /** Human-readable name for logging and error messages */
  name: string;
  /** Firestore field to write the result to (e.g., 'grammarAnalysis') */
  dataField: string;
  /** Firestore field for status tracking (e.g., 'grammarStatus') */
  statusField: string;
  /** The analysis function to run */
  analyze: AnalysisFn<T>;
  /** Optional: extract log-worthy fields from the result */
  logSummary?: (result: T) => Record<string, unknown>;
}

export function createAnalysisHandler<T>(config: AnalysisHandlerConfig<T>) {
  return onCall(
    { timeoutSeconds: 180, secrets: [geminiApiKey] },
    async (request) => {
      // Gate: auth + allowlist
      if (!request.auth) {
        throw new HttpsError('unauthenticated', 'Must be signed in');
      }

      const email = request.auth.token.email;
      if (!email || !(await isEmailAllowed(email))) {
        throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
      }

      const { essayId, draftId } = request.data;
      if (!essayId || !draftId) {
        throw new HttpsError('invalid-argument', 'essayId and draftId are required');
      }

      // Resolve owner: if ownerUid is set, this is a shared-access request
      const db = getFirestore();
      const uid = await resolveEssayOwner(request.auth.uid, request.data.ownerUid);

      const draftRef = db.doc(`users/${uid}/essays/${essayId}/drafts/${draftId}`);
      const draftDoc = await draftRef.get();

      if (!draftDoc.exists) {
        throw new HttpsError('not-found', 'Draft not found');
      }

      const draftData = draftDoc.data()!;
      const content = draftData.content;
      if (!content) {
        throw new HttpsError('invalid-argument', 'Draft has no content');
      }

      const ctx: AnalysisContext = {
        apiKey: geminiApiKey.value(),
        content,
        draftRef,
        draftData,
        essayId: essayId!,
        requestData: request.data,
      };
      const runAnalysis = () => config.analyze(ctx);

      try {
        logger.info(`Starting ${config.name} analysis`, { essayId, draftId, contentLength: content.length });
        let analysis: T;
        try {
          analysis = await runAnalysis();
        } catch (e: unknown) {
          // AnalysisSkipped: the handler decided there's nothing to analyze
          // (e.g., no assignment prompt). Return to client without writing a result.
          if (e instanceof Error && e.message === 'skipped') {
            return { skipped: true };
          }
          throw e;
        }
        const summary = config.logSummary?.(analysis) ?? {};
        logger.info(`${config.name} analysis complete`, summary);
        await draftRef.update({ [config.dataField]: analysis, [config.statusField]: null });
        return analysis;
      } catch (error: unknown) {
        const errMsg = error instanceof Error ? error.message : String(error);
        const errStack = error instanceof Error ? error.stack : undefined;
        logger.error(`${config.name} analysis failed`, { error: errMsg, stack: errStack });

        // Gemini sometimes returns malformed JSON. Retry once on SyntaxError.
        if (error instanceof SyntaxError) {
          try {
            const analysis = await runAnalysis();
            await draftRef.update({ [config.dataField]: analysis, [config.statusField]: null });
            return analysis;
          } catch (retryError: unknown) {
            const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
            logger.error(`${config.name} analysis retry also failed`, { error: retryMsg });
            await draftRef.update({ [config.statusField]: { stage: 'error', message: 'Analysis failed' } });
            throw new HttpsError('internal', `Failed to analyze ${config.name}. Please try again.`);
          }
        }
        await draftRef.update({ [config.statusField]: { stage: 'error', message: 'Analysis failed' } });
        throw new HttpsError('internal', `Failed to analyze ${config.name}: ${errMsg}`);
      }
    }
  );
}
