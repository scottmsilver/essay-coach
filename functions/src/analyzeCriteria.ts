import { createAnalysisHandler, type AnalysisContext } from './createAnalysisHandler';
import { analyzeCriteriaWithGemini, type CriteriaAnalysis } from './criteria';
import { resolveDocSource } from './gdocResolver';
import { defineString } from 'firebase-functions/params';

const gdocWebAppId = defineString('GDOC_WEBAPP_DEPLOYMENT_ID', { default: '' });

class AnalysisSkipped extends Error {
  constructor() { super('skipped'); }
}

async function analyzeCriteriaForDraft(ctx: AnalysisContext): Promise<CriteriaAnalysis> {
  const essayRef = ctx.draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const essayData = essaySnap.data();
  let teacherCriteria = essayData?.teacherCriteria;

  if (!teacherCriteria?.trim()) {
    await ctx.draftRef.update({ criteriaStatus: null });
    throw new AnalysisSkipped();
  }

  // Re-fetch criteria from Google Docs if imported (same pattern as evaluateEssay)
  const webAppId = gdocWebAppId.value();
  if (webAppId && essayData?.criteriaSource) {
    try {
      teacherCriteria = await resolveDocSource(essayData.criteriaSource, webAppId);
      await essayRef.update({ teacherCriteria });
    } catch (err) {
      console.warn('Failed to re-fetch criteria from Google Docs, using stored criteria:', (err as Error).message);
    }
  }

  const input: Parameters<typeof analyzeCriteriaWithGemini>[1] = {
    teacherCriteria,
    assignmentPrompt: essayData?.assignmentPrompt || '',
    writingType: essayData?.writingType || 'argumentative',
    content: ctx.content,
  };

  const draftNumber = ctx.draftData.draftNumber || 1;
  if (draftNumber > 1) {
    const prevDrafts = await ctx.draftRef.parent
      .where('draftNumber', '==', draftNumber - 1)
      .limit(1)
      .get();
    if (!prevDrafts.empty) {
      const prevData = prevDrafts.docs[0].data();
      if (prevData.criteriaAnalysis) {
        input.previousCriteriaAnalysis = JSON.stringify(prevData.criteriaAnalysis);
      }
      if (prevData.criteriaSnapshot) {
        input.previousCriteriaSnapshot = prevData.criteriaSnapshot;
      }
    }
  }

  const result = await analyzeCriteriaWithGemini(ctx.apiKey, input, ctx.draftRef);
  await ctx.draftRef.update({ criteriaSnapshot: teacherCriteria });

  return result;
}

export const analyzeCriteria = createAnalysisHandler<CriteriaAnalysis>({
  name: 'criteria',
  dataField: 'criteriaAnalysis',
  statusField: 'criteriaStatus',
  analyze: analyzeCriteriaForDraft,
  logSummary: (result) => ({
    totalCriteria: result.criteria.length,
    met: result.criteria.filter((c) => c.status === 'met').length,
    notMet: result.criteria.filter((c) => c.status === 'not_met').length,
  }),
});
