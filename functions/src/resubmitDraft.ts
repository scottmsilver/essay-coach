import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { defineSecret, defineString } from 'firebase-functions/params';
import { isEmailAllowed } from './allowlist';
import { validateResubmitDraft } from './validation';
import { buildResubmissionPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';
import { resolveEssayOwner } from './resolveEssayOwner';
import { resolveDocSource, GDocResolveError } from './gdocResolver';

const geminiApiKey = defineSecret('GEMINI_API_KEY');
const gdocWebAppId = defineString('GDOC_WEBAPP_DEPLOYMENT_ID', { default: '' });

export const resubmitDraft = onCall(
  { timeoutSeconds: 180, secrets: [geminiApiKey] },
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
    const uid = await resolveEssayOwner(request.auth.uid, request.data.ownerUid);

    const essayRef = db.doc(`users/${uid}/essays/${essayId}`);
    const essayDoc = await essayRef.get();
    if (!essayDoc.exists) {
      throw new HttpsError('not-found', 'Essay not found');
    }

    const essayData = essayDoc.data()!;
    let { assignmentPrompt } = essayData;
    const { writingType, currentDraftNumber } = essayData;

    const previousDraftsSnapshot = await essayRef
      .collection('drafts')
      .where('draftNumber', '==', currentDraftNumber)
      .limit(1)
      .get();

    if (previousDraftsSnapshot.empty) {
      throw new HttpsError('internal', 'Previous draft not found');
    }

    // If essay/prompt were GDoc-imported, refresh from the source so re-analyze
    // evaluates the current doc, not the content stashed on the previous draft.
    // Structural failures (bookmark moved) surface as failed-precondition so the
    // client can prompt the user to re-pick the source.
    let freshContent = content;
    const webAppId = gdocWebAppId.value();
    if (webAppId) {
      const previousContent = previousDraftsSnapshot.docs[0].data().content;
      const userEdited = previousContent != null && content !== previousContent;
      if (essayData.contentSource && !userEdited) {
        try {
          freshContent = await resolveDocSource(essayData.contentSource, webAppId);
        } catch (err) {
          if (err instanceof GDocResolveError) {
            throw new HttpsError('failed-precondition', `Essay text — ${err.userMessage}`);
          }
          console.warn('Failed to re-fetch essay from Google Docs for resubmit:', (err as Error).message);
        }
      }
      if (essayData.promptSource) {
        try {
          assignmentPrompt = await resolveDocSource(essayData.promptSource, webAppId);
          await essayRef.update({ assignmentPrompt });
        } catch (err) {
          if (err instanceof GDocResolveError) {
            throw new HttpsError('failed-precondition', `Assignment prompt — ${err.userMessage}`);
          }
          console.warn('Failed to re-fetch prompt from Google Docs for resubmit:', (err as Error).message);
        }
      }
    }

    const previousEvaluation = previousDraftsSnapshot.docs[0].data().evaluation;
    const newDraftNumber = currentDraftNumber + 1;

    const draftRef = essayRef.collection('drafts').doc();
    await draftRef.set({
      draftNumber: newDraftNumber,
      content: freshContent,
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
        content: freshContent,
        previousEvaluation: JSON.stringify(previousEvaluation),
      });
      const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt, draftRef);
      await draftRef.update({ evaluation, evaluationStatus: null });
      return { draftNumber: newDraftNumber, evaluation };
    } catch (error) {
      if (error instanceof SyntaxError) {
        try {
          const prompt = buildResubmissionPrompt({
            assignmentPrompt, writingType, content: freshContent,
            previousEvaluation: JSON.stringify(previousEvaluation),
          });
          const evaluation = await evaluateWithGemini(geminiApiKey.value(), prompt, draftRef);
          await draftRef.update({ evaluation, evaluationStatus: null });
          return { draftNumber: newDraftNumber, evaluation };
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
