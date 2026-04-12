import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { defineSecret } from 'firebase-functions/params';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';
import { analyzeGrammarWithGemini } from './grammar';
import { analyzeTransitionsWithGemini } from './transitions';
import { analyzePromptWithGemini } from './promptAdherence';
import { analyzeDuplicationWithGemini } from './duplication';
import { analyzeCriteriaWithGemini } from './criteria';
import { evaluateWithGemini } from './gemini';
import { buildEvaluationPrompt, buildResubmissionPrompt } from './prompt';
import { synthesizeCoachForDraft } from './synthesizeCoach';
import { megaAnalyze } from './megaAnalyze';
import { getFirestore } from 'firebase-admin/firestore';

const geminiApiKey = defineSecret('GEMINI_API_KEY');

/** Check if a status field indicates the client actually started processing (not just claimed) */
function isActivelyProcessing(status: { stage: string } | null | undefined): boolean {
  if (!status) return false;
  return status.stage === 'thinking' || status.stage === 'generating';
}

/**
 * DRY helper: run an analysis if the client hasn't started it.
 * Handles the check → log → try/catch → Firestore update pattern
 * that all simple analyses share.
 */
function runIfNeeded(
  tasks: Promise<void>[],
  opts: {
    data: FirebaseFirestore.DocumentData;
    draftRef: DocumentReference;
    essayId: string;
    draftId: string;
    statusField: string;
    dataField: string;
    label: string;
    analyze: () => Promise<unknown>;
  },
) {
  const { data, draftRef, essayId, draftId, statusField, dataField, label, analyze } = opts;

  if (!data.megaInProgress && !isActivelyProcessing(data[statusField]) && !data[dataField]) {
    logger.info(`${label} not actively processing — trigger firing`, { essayId, draftId, status: data[statusField]?.stage });
    tasks.push(
      (async () => {
        try {
          const analysis = await analyze();
          await draftRef.update({ [dataField]: analysis, [statusField]: null });
          logger.info(`Trigger ${label} analysis complete`, { essayId, draftId });
        } catch (error: unknown) {
          const msg = error instanceof Error ? error.message : String(error);
          logger.error(`Trigger ${label} analysis failed`, { error: msg, essayId, draftId });
          await draftRef.update({ [statusField]: { stage: 'error', message: 'Analysis failed' } });
        }
      })()
    );
  } else {
    logger.info(`${label} already processing or complete, skipping`, { essayId, draftId });
  }
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

    // ── Mega mode: single combined Gemini call ──────────────────────────
    const db = getFirestore();
    const megaConfig = await db.doc('config/megaPrompt').get();
    if (megaConfig.exists && megaConfig.data()?.enabled) {
      const megaModel = megaConfig.data()?.model || 'gemini-3.1-flash-lite-preview';

      try {
        // Mark mega in progress so fallback path doesn't also start
        await draftRef.update({ megaInProgress: true });

        // Set all status fields to thinking
        await draftRef.update({
          evaluationStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          grammarStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          transitionStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          promptStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          duplicationStatus: { stage: 'thinking', message: 'Analyzing essay...' },
          coachSynthesisStatus: { stage: 'thinking', message: 'Analyzing essay...' },
        });

        // Load essay metadata
        const essayRef = draftRef.parent.parent!;
        const essaySnap = await essayRef.get();
        const essayData = essaySnap.data();
        const assignmentPrompt = essayData?.assignmentPrompt || '';
        const writingType = essayData?.writingType || 'argumentative';
        const content = snap.data()!.content;
        const draftNumber = snap.data()!.draftNumber || 1;

        // Load previous evaluation for resubmissions
        let previousEvaluation: Record<string, unknown> | null = null;
        if (draftNumber > 1) {
          const prevDrafts = await draftRef.parent
            .where('draftNumber', '==', draftNumber - 1)
            .limit(1)
            .get();
          previousEvaluation = prevDrafts.empty
            ? null
            : prevDrafts.docs[0].data().evaluation || null;
        }

        const result = await megaAnalyze({
          apiKey: geminiApiKey.value(),
          content,
          assignmentPrompt,
          writingType,
          draftNumber,
          previousEvaluation,
          model: megaModel,
          draftRef,
        });

        // Write all 6 analysis fields + clear all status fields
        await draftRef.update({
          evaluation: result.evaluation,
          grammarAnalysis: result.grammarAnalysis,
          transitionAnalysis: result.transitionAnalysis,
          promptAnalysis: result.promptAnalysis,
          duplicationAnalysis: result.duplicationAnalysis,
          coachSynthesis: result.coachSynthesis,
          evaluationStatus: null,
          grammarStatus: null,
          transitionStatus: null,
          promptStatus: null,
          duplicationStatus: null,
          coachSynthesisStatus: null,
          megaInProgress: null,
        });

        logger.info('Mega analysis complete', { uid, essayId, draftId, model: megaModel });

        // Criteria analysis runs separately from mega — fire if criteria exist
        const teacherCriteria = essayData?.teacherCriteria;
        if (teacherCriteria?.trim()) {
          try {
            const criteriaInput = {
              teacherCriteria,
              assignmentPrompt,
              writingType,
              content,
              previousCriteriaAnalysis: undefined as string | undefined,
              previousCriteriaSnapshot: undefined as string | undefined,
            };
            if (draftNumber > 1) {
              const prevDrafts = await draftRef.parent.where('draftNumber', '==', draftNumber - 1).limit(1).get();
              if (!prevDrafts.empty) {
                const prevData = prevDrafts.docs[0].data();
                if (prevData.criteriaAnalysis) criteriaInput.previousCriteriaAnalysis = JSON.stringify(prevData.criteriaAnalysis);
                if (prevData.criteriaSnapshot) criteriaInput.previousCriteriaSnapshot = prevData.criteriaSnapshot;
              }
            }
            const criteriaResult = await analyzeCriteriaWithGemini(geminiApiKey.value(), criteriaInput, draftRef);
            await draftRef.update({ criteriaAnalysis: criteriaResult, criteriaStatus: null, criteriaSnapshot: teacherCriteria });
            logger.info('Criteria analysis complete (post-mega)', { essayId, draftId });
          } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            logger.error('Criteria analysis failed (post-mega)', { error: msg, essayId, draftId });
            await draftRef.update({ criteriaStatus: { stage: 'error', message: 'Criteria analysis failed' } });
          }
        }

        return; // Done — skip the entire existing parallel path
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        logger.error('Mega analysis failed, falling back to separate calls', { error: msg, uid, essayId, draftId });

        // Retry once on SyntaxError
        if (error instanceof SyntaxError) {
          try {
            const essayRef = draftRef.parent.parent!;
            const essaySnap = await essayRef.get();
            const essayData = essaySnap.data();

            const result = await megaAnalyze({
              apiKey: geminiApiKey.value(),
              content: snap.data()!.content,
              assignmentPrompt: essayData?.assignmentPrompt || '',
              writingType: essayData?.writingType || 'argumentative',
              draftNumber: snap.data()!.draftNumber || 1,
              previousEvaluation: null,
              model: megaConfig.data()?.model || 'gemini-3.1-flash-lite-preview',
              draftRef,
            });

            await draftRef.update({
              evaluation: result.evaluation,
              grammarAnalysis: result.grammarAnalysis,
              transitionAnalysis: result.transitionAnalysis,
              promptAnalysis: result.promptAnalysis,
              duplicationAnalysis: result.duplicationAnalysis,
              coachSynthesis: result.coachSynthesis,
              evaluationStatus: null, grammarStatus: null, transitionStatus: null,
              promptStatus: null, duplicationStatus: null, coachSynthesisStatus: null,
              megaInProgress: null,
            });

            logger.info('Mega analysis retry succeeded', { uid, essayId, draftId });
            return;
          } catch (retryError: unknown) {
            logger.error('Mega analysis retry also failed', { error: retryError instanceof Error ? retryError.message : String(retryError) });
          }
        }

        // Clear mega lock so fallback path can proceed
        await draftRef.update({
          megaInProgress: null,
          evaluationStatus: null, grammarStatus: null, transitionStatus: null,
          promptStatus: null, duplicationStatus: null, coachSynthesisStatus: null,
        });
        // Fall through to existing parallel dispatch below
      }
    }
    // ── End mega mode guard ─────────────────────────────────────────────

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
    const shared = { data, draftRef, essayId, draftId };

    // Simple analyses: all follow the same pattern
    runIfNeeded(tasks, {
      ...shared, label: 'Grammar',
      statusField: 'grammarStatus', dataField: 'grammarAnalysis',
      analyze: () => analyzeGrammarWithGemini(apiKey, content, draftRef),
    });

    runIfNeeded(tasks, {
      ...shared, label: 'Transitions',
      statusField: 'transitionStatus', dataField: 'transitionAnalysis',
      analyze: () => analyzeTransitionsWithGemini(apiKey, content, draftRef, data.transitionAnalysis || null),
    });

    runIfNeeded(tasks, {
      ...shared, label: 'Duplication',
      statusField: 'duplicationStatus', dataField: 'duplicationAnalysis',
      analyze: () => analyzeDuplicationWithGemini(apiKey, content, draftRef),
    });

    // Evaluation: special case (needs essay data for prompt building)
    if (!isActivelyProcessing(data.evaluationStatus) && !data.evaluation) {
      logger.info('Evaluation not actively processing — trigger firing', { essayId, draftId, status: data.evaluationStatus?.stage });
      tasks.push(
        (async () => {
          try {
            const essayRef = draftRef.parent.parent!;
            const essaySnap = await essayRef.get();
            const essayData = essaySnap.data();
            const assignmentPrompt = essayData?.assignmentPrompt || '';
            const writingType = essayData?.writingType || 'argumentative';

            let prompt: string;
            if (data.draftNumber > 1) {
              const draftsSnap = await draftRef.parent.where('draftNumber', '==', data.draftNumber - 1).limit(1).get();
              const prevEval = draftsSnap.docs[0]?.data()?.evaluation;
              prompt = prevEval
                ? buildResubmissionPrompt({ assignmentPrompt, writingType, content, previousEvaluation: prevEval })
                : buildEvaluationPrompt({ assignmentPrompt, writingType, content });
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

    // Prompt adherence: special case (conditional on assignment prompt existing)
    if (!isActivelyProcessing(data.promptStatus) && !data.promptAnalysis) {
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

    // Criteria analysis: conditional on teacher criteria existing
    if (!isActivelyProcessing(data.criteriaStatus) && !data.criteriaAnalysis) {
      const essayRef = draftRef.parent.parent!;
      const essaySnap = await essayRef.get();
      const teacherCriteria = essaySnap.data()?.teacherCriteria;

      if (teacherCriteria?.trim()) {
        logger.info('Criteria analysis not actively processing — trigger firing', { essayId, draftId });
        tasks.push(
          (async () => {
            try {
              const essayData = essaySnap.data()!;
              const criteriaInput: Parameters<typeof analyzeCriteriaWithGemini>[1] = {
                teacherCriteria,
                assignmentPrompt: essayData.assignmentPrompt || '',
                writingType: essayData.writingType || 'argumentative',
                content,
              };
              const draftNumber = data.draftNumber || 1;
              if (draftNumber > 1) {
                const prevDrafts = await draftRef.parent.where('draftNumber', '==', draftNumber - 1).limit(1).get();
                if (!prevDrafts.empty) {
                  const prevData = prevDrafts.docs[0].data();
                  if (prevData.criteriaAnalysis) criteriaInput.previousCriteriaAnalysis = JSON.stringify(prevData.criteriaAnalysis);
                  if (prevData.criteriaSnapshot) criteriaInput.previousCriteriaSnapshot = prevData.criteriaSnapshot;
                }
              }
              const analysis = await analyzeCriteriaWithGemini(apiKey, criteriaInput, draftRef);
              await draftRef.update({ criteriaAnalysis: analysis, criteriaStatus: null, criteriaSnapshot: teacherCriteria });
              logger.info('Trigger criteria analysis complete', { essayId, draftId });
            } catch (error: unknown) {
              const msg = error instanceof Error ? error.message : String(error);
              logger.error('Trigger criteria analysis failed', { error: msg, essayId, draftId });
              await draftRef.update({ criteriaStatus: { stage: 'error', message: 'Criteria analysis failed' } });
            }
          })()
        );
      }
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
