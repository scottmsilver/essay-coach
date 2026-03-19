import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { analyzeGrammarWithGemini } from './grammar';
import { analyzeTransitionsWithGemini } from './transitions';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

/**
 * Firestore trigger fallback: when a new draft is created, wait 5 seconds
 * then check if grammar/transitions were already claimed by the client.
 * If not, fire them so analyses complete even if the tab closes.
 */
export const onDraftCreated = onDocumentCreated(
  {
    document: 'users/{uid}/essays/{essayId}/drafts/{draftId}',
    timeoutSeconds: 180,
    secrets: [geminiApiKey],
  },
  async (event) => {
    const snap = event.data;
    if (!snap) return;

    const { uid, essayId, draftId } = event.params;
    const draftRef = snap.ref;

    // Wait 5 seconds to give the client time to claim analyses
    await new Promise((r) => setTimeout(r, 5000));

    // Re-read the draft to see if client already claimed
    const freshSnap = await draftRef.get();
    if (!freshSnap.exists) {
      logger.warn('Draft deleted before trigger could run', { uid, essayId, draftId });
      return;
    }

    const data = freshSnap.data()!;
    const content = data.content;
    if (!content) {
      logger.warn('Draft has no content, skipping analyses', { uid, essayId, draftId });
      return;
    }

    const apiKey = geminiApiKey.value();
    const tasks: Promise<void>[] = [];

    // Grammar: fire if client didn't claim
    if (!data.grammarStatus) {
      logger.info('Grammar unclaimed — trigger firing', { essayId, draftId });
      tasks.push(
        (async () => {
          try {
            const analysis = await analyzeGrammarWithGemini(apiKey, content, draftRef);
            await draftRef.update({ grammarAnalysis: analysis, grammarStatus: null });
            logger.info('Trigger grammar analysis complete', { essayId, draftId });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('Trigger grammar analysis failed', { error: msg, essayId, draftId });
            await draftRef.update({ grammarStatus: { stage: 'error', message: 'Analysis failed' } });
          }
        })()
      );
    } else {
      logger.info('Grammar already claimed by client, skipping', { essayId, draftId });
    }

    // Transitions: fire if client didn't claim
    if (!data.transitionStatus) {
      logger.info('Transitions unclaimed — trigger firing', { essayId, draftId });
      tasks.push(
        (async () => {
          try {
            const analysis = await analyzeTransitionsWithGemini(apiKey, content, draftRef);
            await draftRef.update({ transitionAnalysis: analysis, transitionStatus: null });
            logger.info('Trigger transition analysis complete', { essayId, draftId });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('Trigger transition analysis failed', { error: msg, essayId, draftId });
            await draftRef.update({ transitionStatus: { stage: 'error', message: 'Analysis failed' } });
          }
        })()
      );
    } else {
      logger.info('Transitions already claimed by client, skipping', { essayId, draftId });
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }
  }
);
