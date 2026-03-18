import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';
import { resolveEssayOwner } from './resolveEssayOwner';
import { resolveDocSource } from './gdocResolver';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const gdocWebAppId = defineString('GDOC_WEBAPP_DEPLOYMENT_ID', { default: '' });

/**
 * Evaluate an existing draft that doesn't have an evaluation yet.
 * Called after the client creates the essay + draft docs and navigates.
 */
export const evaluateEssay = onCall(
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

    const essayRef = db.doc(`users/${uid}/essays/${essayId}`);
    const essayDoc = await essayRef.get();
    if (!essayDoc.exists) {
      throw new HttpsError('not-found', 'Essay not found');
    }

    const draftRef = essayRef.collection('drafts').doc(draftId);
    const draftDoc = await draftRef.get();
    if (!draftDoc.exists) {
      throw new HttpsError('not-found', 'Draft not found');
    }

    const draftData = draftDoc.data()!;
    if (draftData.evaluation && !request.data.force) {
      return { evaluation: draftData.evaluation };
    }

    const essayData = essayDoc.data()!;
    let { assignmentPrompt, writingType } = essayData;
    let { content } = draftData;
    const { draftNumber } = draftData;

    // Re-fetch from Google Docs if doc sources are set
    const webAppId = gdocWebAppId.value();
    if (webAppId) {
      if (essayData.contentSource) {
        try {
          content = await resolveDocSource(essayData.contentSource, webAppId);
          await draftRef.update({ content });
        } catch (err) {
          console.warn('Failed to re-fetch essay from Google Docs, using stored content:', (err as Error).message);
        }
      }
      if (essayData.promptSource) {
        try {
          assignmentPrompt = await resolveDocSource(essayData.promptSource, webAppId);
          await essayRef.update({ assignmentPrompt });
        } catch (err) {
          console.warn('Failed to re-fetch prompt from Google Docs, using stored prompt:', (err as Error).message);
        }
      }
    }

    try {
      let prompt: string;

      if (draftNumber > 1) {
        // Resubmission — find previous draft's evaluation
        const prevDrafts = await essayRef
          .collection('drafts')
          .where('draftNumber', '==', draftNumber - 1)
          .limit(1)
          .get();
        const previousEvaluation = prevDrafts.empty
          ? null
          : prevDrafts.docs[0].data().evaluation;

        prompt = previousEvaluation
          ? buildResubmissionPrompt({
              assignmentPrompt, writingType, content,
              previousEvaluation: JSON.stringify(previousEvaluation),
            })
          : buildEvaluationPrompt({ assignmentPrompt, writingType, content });
      } else {
        prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
      }

      const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt, draftRef);
      await draftRef.update({ evaluation, evaluationStatus: null });
      return { evaluation };
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
          const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt, draftRef);
          await draftRef.update({ evaluation, evaluationStatus: null });
          return { evaluation };
        } catch {
          await draftRef.update({ evaluationStatus: { stage: 'error', message: 'Evaluation failed' } });
          throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
        }
      }
      await draftRef.update({ evaluationStatus: { stage: 'error', message: 'Evaluation failed' } });
      throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
    }
  }
);
