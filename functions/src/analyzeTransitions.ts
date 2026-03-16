import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { analyzeTransitionsWithGemini } from './transitions';
import { resolveEssayOwner } from './resolveEssayOwner';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const analyzeTransitions = onCall(
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
    const uid = await resolveEssayOwner(request.auth.uid, request.data.ownerUid);

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
      logger.info('Starting transition analysis', { essayId, draftId, contentLength: content.length });
      const analysis = await analyzeTransitionsWithGemini(geminiApiKey.value(), content, draftRef);
      logger.info('Transition analysis complete', { sentenceCount: analysis.sentenceTransitions.length, paragraphCount: analysis.paragraphTransitions.length });
      await draftRef.update({ transitionAnalysis: analysis, transitionStatus: null });
      return analysis;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error('Transition analysis failed', { error: errMsg, stack: errStack });
      if (error instanceof SyntaxError) {
        try {
          const analysis = await analyzeTransitionsWithGemini(geminiApiKey.value(), content, draftRef);
          await draftRef.update({ transitionAnalysis: analysis, transitionStatus: null });
          return analysis;
        } catch (retryError: unknown) {
          const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
          logger.error('Transition analysis retry also failed', { error: retryMsg });
          await draftRef.update({ transitionStatus: { stage: 'error', message: 'Analysis failed' } });
          throw new HttpsError('internal', 'Failed to analyze transitions. Please try again.');
        }
      }
      await draftRef.update({ transitionStatus: { stage: 'error', message: 'Analysis failed' } });
      throw new HttpsError('internal', `Failed to analyze transitions: ${errMsg}`);
    }
  }
);
