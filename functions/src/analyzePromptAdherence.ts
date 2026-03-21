import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { isEmailAllowed } from './allowlist';
import { analyzePromptWithGemini } from './promptAdherence';
import { resolveEssayOwner } from './resolveEssayOwner';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const analyzePromptAdherence = onCall(
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

    // Read the parent essay doc to get assignmentPrompt
    const essayRef = draftRef.parent.parent!;
    const essaySnap = await essayRef.get();
    const assignmentPrompt = essaySnap.data()?.assignmentPrompt;

    if (!assignmentPrompt?.trim()) {
      // No prompt to analyze against — skip
      await draftRef.update({ promptStatus: null });
      return { skipped: true };
    }

    try {
      logger.info('Starting prompt adherence analysis', { essayId, draftId, contentLength: content.length });
      const analysis = await analyzePromptWithGemini(geminiApiKey.value(), assignmentPrompt, content, draftRef);
      logger.info('Prompt adherence analysis complete', {
        totalCells: analysis.summary.totalCells,
        filledCells: analysis.summary.filledCells,
      });
      await draftRef.update({ promptAnalysis: analysis, promptStatus: null });
      return analysis;
    } catch (error: unknown) {
      const errMsg = error instanceof Error ? error.message : String(error);
      const errStack = error instanceof Error ? error.stack : undefined;
      logger.error('Prompt adherence analysis failed', { error: errMsg, stack: errStack });
      if (error instanceof SyntaxError) {
        try {
          const analysis = await analyzePromptWithGemini(geminiApiKey.value(), assignmentPrompt, content, draftRef);
          await draftRef.update({ promptAnalysis: analysis, promptStatus: null });
          return analysis;
        } catch (retryError: unknown) {
          const retryMsg = retryError instanceof Error ? retryError.message : String(retryError);
          logger.error('Prompt adherence analysis retry also failed', { error: retryMsg });
          await draftRef.update({ promptStatus: { stage: 'error', message: 'Analysis failed' } });
          throw new HttpsError('internal', 'Failed to analyze prompt adherence. Please try again.');
        }
      }
      await draftRef.update({ promptStatus: { stage: 'error', message: 'Analysis failed' } });
      throw new HttpsError('internal', `Failed to analyze prompt adherence: ${errMsg}`);
    }
  }
);
