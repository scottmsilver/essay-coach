import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { analyzeGrammarWithGemini } from './grammar';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const analyzeGrammar = onCall(
  { timeoutSeconds: 180, secrets: [geminiApiKey] },
  async (request) => {
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

    const db = getFirestore();
    const uid = request.auth.uid;

    const draftRef = db.doc(`users/${uid}/essays/${essayId}/drafts/${draftId}`);
    const draftDoc = await draftRef.get();

    if (!draftDoc.exists) {
      throw new HttpsError('not-found', 'Draft not found');
    }

    const content = draftDoc.data()!.content;
    if (!content) {
      throw new HttpsError('invalid-argument', 'Draft has no content');
    }

    try {
      logger.info('Starting grammar analysis', { essayId, draftId, contentLength: content.length });
      const analysis = await analyzeGrammarWithGemini(geminiApiKey.value(), content, draftRef);
      logger.info('Grammar analysis complete', { totalErrors: analysis.summary.totalErrors });
      await draftRef.update({ grammarAnalysis: analysis, grammarStatus: null });
      return analysis;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error('Grammar analysis failed', { error: errMsg, stack: errStack });
      if (error instanceof SyntaxError) {
        try {
          const analysis = await analyzeGrammarWithGemini(geminiApiKey.value(), content, draftRef);
          await draftRef.update({ grammarAnalysis: analysis, grammarStatus: null });
          return analysis;
        } catch (retryError: unknown) {
          const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
          logger.error('Grammar analysis retry also failed', { error: retryMsg });
          await draftRef.update({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
          throw new HttpsError('internal', 'Failed to analyze grammar. Please try again.');
        }
      }
      await draftRef.update({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
      throw new HttpsError('internal', `Failed to analyze grammar: ${errMsg}`);
    }
  }
);
