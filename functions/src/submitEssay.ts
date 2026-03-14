import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { validateSubmitEssay } from './validation';
import { buildEvaluationPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

export const submitEssay = onCall(
  { timeoutSeconds: 120, secrets: [geminiApiKey] },
  async (request) => {
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Must be signed in');
    }

    const email = request.auth.token.email;
    if (!email || !(await isEmailAllowed(email))) {
      throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
    }

    const { title, assignmentPrompt, writingType, content } = request.data;
    const validationError = validateSubmitEssay({ title, assignmentPrompt, writingType, content });
    if (validationError) {
      throw new HttpsError('invalid-argument', validationError);
    }

    const db = getFirestore();
    const uid = request.auth.uid;

    const essayRef = db.collection(`users/${uid}/essays`).doc();
    await essayRef.set({
      title,
      assignmentPrompt,
      writingType,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      currentDraftNumber: 1,
    });

    const draftRef = essayRef.collection('drafts').doc();
    await draftRef.set({
      draftNumber: 1,
      content,
      submittedAt: FieldValue.serverTimestamp(),
      evaluation: null,
      revisionStage: null,
    });

    try {
      const prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
      const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
      await draftRef.update({ evaluation });
      return { essayId: essayRef.id, evaluation };
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
          const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt);
          await draftRef.update({ evaluation });
          return { essayId: essayRef.id, evaluation };
        } catch {
          throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
        }
      }
      throw new HttpsError('internal', 'Failed to evaluate essay. Please try again.');
    }
  }
);
