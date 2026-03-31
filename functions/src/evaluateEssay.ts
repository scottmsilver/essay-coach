import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { evaluateWithGemini } from './gemini';
import { resolveDocSource } from './gdocResolver';
import { defineString } from 'firebase-functions/params';

const gdocWebAppId = defineString('GDOC_WEBAPP_DEPLOYMENT_ID', { default: '' });

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Evaluation = Record<string, any>;

/**
 * The 6+1 Traits evaluation is the most complex analysis. Unlike grammar/transitions/prompt
 * which just run a Gemini call against the essay content, evaluation has extra logic:
 *
 * 1. Force flag: if the draft already has an evaluation, skip unless request.data.force is set.
 *    The client sends force=true when the user clicks "Re-run" on an existing evaluation.
 *
 * 2. Google Docs re-fetch: if the essay was imported from Google Docs, re-fetch the latest
 *    content and prompt before evaluating. This ensures the evaluation scores the current
 *    document, not a stale snapshot. The updated content is written back to Firestore.
 *
 * 3. Resubmission prompt: for draft 2+, the evaluation prompt includes the previous draft's
 *    scores so Gemini can compare and note improvements. If no previous evaluation exists
 *    (e.g., the prior draft failed), it falls back to a fresh evaluation prompt.
 */
async function evaluateEssayForDraft(ctx: AnalysisContext): Promise<Evaluation> {
  const { draftData, draftRef, requestData } = ctx;

  if (draftData.evaluation && !requestData.force) {
    return draftData.evaluation;
  }

  const essayRef = draftRef.parent.parent!;
  const essayDoc = await essayRef.get();
  const essayData = essayDoc.data()!;
  let { assignmentPrompt, writingType } = essayData;
  let content = ctx.content;
  const { draftNumber } = draftData;

  // Re-fetch from Google Docs if the essay/prompt were imported.
  // Fails gracefully: if the GDoc fetch fails, we evaluate the stored content.
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

  // For revisions (draft 2+), include previous scores so Gemini can compare.
  // Falls back to a fresh evaluation prompt if no previous evaluation exists.
  let prompt: string;

  if (draftNumber > 1) {
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

  return evaluateWithGemini(ctx.apiKey, prompt, draftRef);
}

export const evaluateEssay = createAnalysisHandler<Evaluation>({
  name: 'evaluation',
  dataField: 'evaluation',
  statusField: 'evaluationStatus',
  analyze: evaluateEssayForDraft,
});
