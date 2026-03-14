import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { validateResubmitDraft } from './validation';
import { buildResubmissionPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const resubmitDraft = onCall(
  { timeoutSeconds: 120, secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }

    const { essayId, content } = request.data;
    const validationError = validateResubmitDraft({ essayId, content });
    if (validationError) {
      throw new HttpsError('invalid-argument', validationError);
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    const essayRef = db.doc(`users/${uid}/essays/${essayId}`);
    const essayDoc = await essayRef.get();
    if (!essayDoc.exists) {
      throw new HttpsError('not-found', 'Essay not found');
    }

    const essayData = essayDoc.data()!;
    const { assignmentPrompt, writingType, currentDraftNumber } = essayData;

    const previousDraftsSnapshot = await essayRef
      .collection('drafts')
      .where('draftNumber', '==', currentDraftNumber)
      .limit(1)
      .get();

    if (previousDraftsSnapshot.empty) {
      throw new HttpsError('internal', 'Previous draft not found');
    }

    const previousEvaluation = previousDraftsSnapshot.docs[0].data().evaluation;
    const newDraftNumber = currentDraftNumber + 1;

    const draftRef = essayRef.collection('drafts').doc();
    await draftRef.set({
      draftNumber: newDraftNumber,
      content,
      submittedAt: FieldValue.serverTimestamp(),
      evaluation: null,
      revisionStage: null,
    });

    await essayRef.update({
      currentDraftNumber: newDraftNumber,
      updatedAt: FieldValue.serverTimestamp(),
    });

    try {
      const prompt = buildResubmissionPrompt({
        assignmentPrompt,
        writingType,
        content,
        previousEvaluation: JSON.stringify(previousEvaluation),
      });
      const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
      await draftRef.update({ evaluation });
      return { draftNumber: newDraftNumber, evaluation };
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const prompt = buildResubmissionPrompt({
            assignmentPrompt, writingType, content,
            previousEvaluation: JSON.stringify(previousEvaluation),
          });
          const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
          await draftRef.update({ evaluation });
          return { draftNumber: newDraftNumber, evaluation };
        } catch {
          throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
        }
      }
      throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
    }
  }
);
