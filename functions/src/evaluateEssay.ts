import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';
import { resolveEssayOwner } from './resolveEssayOwner';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

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
    if (draftData.evaluation) {
      return { evaluation: draftData.evaluation };
    }

    const essayData = essayDoc.data()!;
    const { assignmentPrompt, writingType } = essayData;
    const { content, draftNumber } = draftData;

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
