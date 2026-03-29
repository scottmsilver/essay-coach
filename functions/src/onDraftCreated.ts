import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import { analyzeGrammarWithGemini } from './grammar';
import { analyzeTransitionsWithGemini } from './transitions';
import { analyzePromptWithGemini } from './promptAdherence';
import { evaluateWithGemini } from './gemini';
import { buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { synthesizeCoachForDraft } from './synthesizeCoach';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

/** Check if a status field indicates the client actually started processing (not just claimed) */
function isActivelyProcessing(status: { stage: string } | null | undefined): boolean {
  if (!status) return false;
  return status.stage === 'thinking' || status.stage === 'generating';
}

/**
 * Firestore trigger fallback: when a new draft is created, wait 5 seconds
 * then check if analyses were already started by the client.
 * If not (or if still stuck in 'pending'), fire them so analyses complete
 * even if the tab closes.
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

    // Wait 5 seconds to give the client time to start analyses
    await new Promise((r) => setTimeout(r, 5000));

    // Re-read the draft to see if client already started processing
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

    // Grammar: fire if client didn't start (absent or still 'pending')
    if (!isActivelyProcessing(data.grammarStatus) && !data.grammarAnalysis) {
      logger.info('Grammar not actively processing — trigger firing', { essayId, draftId, status: data.grammarStatus?.stage });
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
      logger.info('Grammar already processing or complete, skipping', { essayId, draftId });
    }

    // Transitions: fire if client didn't start (absent or still 'pending')
    if (!isActivelyProcessing(data.transitionStatus) && !data.transitionAnalysis) {
      logger.info('Transitions not actively processing — trigger firing', { essayId, draftId, status: data.transitionStatus?.stage });
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
      logger.info('Transitions already processing or complete, skipping', { essayId, draftId });
    }

    // Evaluation: fire if client didn't start (absent or still 'pending')
    if (!isActivelyProcessing(data.evaluationStatus) && !data.evaluation) {
      logger.info('Evaluation not actively processing — trigger firing', { essayId, draftId, status: data.evaluationStatus?.stage });
      tasks.push(
        (async () => {
          try {
            // Get essay data for prompt building
            const essayRef = draftRef.parent.parent!;
            const essaySnap = await essayRef.get();
            const essayData = essaySnap.data();
            const assignmentPrompt = essayData?.assignmentPrompt || '';
            const writingType = essayData?.writingType || 'argumentative';

            // Check if this is a resubmission (draftNumber > 1)
            let prompt: string;
            if (data.draftNumber > 1) {
              // Try to get previous draft's evaluation for resubmission prompt
              const draftsSnap = await draftRef.parent.where('draftNumber', '==', data.draftNumber - 1).limit(1).get();
              const prevEval = draftsSnap.docs[0]?.data()?.evaluation;
              if (prevEval) {
                prompt = buildResubmissionPrompt({ assignmentPrompt, writingType, content, previousEvaluation: prevEval });
              } else {
                prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
              }
            } else {
              prompt = buildEvaluationPrompt({ assignmentPrompt, writingType, content });
            }

            const evaluation = await evaluateWithGemini(apiKey, prompt, draftRef);
            await draftRef.update({ evaluation, evaluationStatus: null });
            logger.info('Trigger evaluation complete', { essayId, draftId });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('Trigger evaluation failed', { error: msg, essayId, draftId });
            await draftRef.update({ evaluationStatus: { stage: 'error', message: 'Evaluation failed' } });
          }
        })()
      );
    } else {
      logger.info('Evaluation already processing or complete, skipping', { essayId, draftId });
    }

    // Prompt adherence: fire if client didn't start and essay has an assignmentPrompt
    if (!isActivelyProcessing(data.promptStatus) && !data.promptAnalysis) {
      // Read the essay doc to check for assignmentPrompt
      const essayRef = draftRef.parent.parent!;
      const essaySnap = await essayRef.get();
      const assignmentPrompt = essaySnap.data()?.assignmentPrompt;

      if (assignmentPrompt?.trim()) {
        logger.info('Prompt adherence not actively processing — trigger firing', { essayId, draftId, status: data.promptStatus?.stage });
        tasks.push(
          (async () => {
            try {
              const analysis = await analyzePromptWithGemini(apiKey, assignmentPrompt, content, draftRef);
              await draftRef.update({ promptAnalysis: analysis, promptStatus: null });
              logger.info('Trigger prompt adherence analysis complete', { essayId, draftId });
            } catch (error: unknown) {
              const msg = error instanceof Error ? error.message : String(error);
              logger.error('Trigger prompt adherence analysis failed', { error: msg, essayId, draftId });
              await draftRef.update({ promptStatus: { stage: 'error', message: 'Analysis failed' } });
            }
          })()
        );
      } else {
        logger.info('No assignment prompt, skipping prompt adherence', { essayId, draftId });
      }
    } else {
      logger.info('Prompt adherence already processing or complete, skipping', { essayId, draftId });
    }

    if (tasks.length > 0) {
      await Promise.allSettled(tasks);
    }

    // After analyses settle, run coach synthesis (polls for data internally)
    try {
      await synthesizeCoachForDraft(apiKey, draftRef);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Coach synthesis failed', { error: msg, essayId, draftId });
      await draftRef.update({ coachSynthesisStatus: { stage: 'error', message: 'Coach synthesis failed' } });
    }
  }
);
