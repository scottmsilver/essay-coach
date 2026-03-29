import { GoogleGenAI } from '@google/genai';
import { logger } from 'firebase-functions/v2';
import type { DocumentReference } from 'firebase-admin/firestore';

const MODEL = 'gemini-2.0-flash-lite';

const COACH_SYNTHESIS_SYSTEM = `You are a writing coach summarizing the state of a student's essay revision. You receive analysis data from multiple reports (grammar, transitions, prompt adherence, trait evaluation) and produce a concise coaching synthesis.

Your job:
1. Count issues in each report area
2. Determine overall readiness
3. Write a 1-2 sentence coach note (warm, direct, specific)
4. Recommend which report to focus on next (the one with the most impactful issues)
5. If this is a revision (previous data provided), note what improved

READINESS LEVELS:
- "keep_going": Multiple reports have significant issues. Student has real work to do.
- "getting_close": Most reports are clean or nearly clean. 1-2 areas still need attention.
- "almost_there": Only 1 minor issue remaining across all reports.
- "ready": All reports are clear or have only trivial remaining items. The essay has been thoughtfully revised.

RULES:
- Never say "ready" on draft 1. Revision IS the point.
- Count grammar issues from the summary.totalErrors field.
- Count transition issues by counting "Weak" or "Missing" quality transitions.
- Count prompt gaps by counting questions where addressed=false or cells with status="empty" or "partial".
- Count overall/trait suggestions by counting traits with revisionPriority !== null. Use key "overall" for trait-level feedback.
- Be honest. If the essay has problems, say so warmly but clearly.
- The coach note should sound like a real teacher, not a bot. Reference specific things about the essay.`;

const COACH_SYNTHESIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    readiness: {
      type: 'string' as const,
      enum: ['keep_going', 'getting_close', 'almost_there', 'ready'],
    },
    coachNote: { type: 'string' as const },
    recommendedReport: {
      type: 'string' as const,
      enum: ['grammar', 'transitions', 'prompt', 'overall'],
    },
    reportSummaries: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          key: { type: 'string' as const, enum: ['grammar', 'transitions', 'prompt', 'overall'] },
          issueCount: { type: 'number' as const },
          label: { type: 'string' as const },
          detail: { type: 'string' as const },
          previousCount: { type: 'number' as const, nullable: true },
        },
        required: ['key', 'issueCount', 'label', 'detail', 'previousCount'],
      },
    },
    improvements: {
      type: 'array' as const,
      nullable: true,
      items: { type: 'string' as const },
    },
  },
  required: ['readiness', 'coachNote', 'recommendedReport', 'reportSummaries', 'improvements'],
};

interface SynthesisInput {
  draftNumber: number;
  evaluation: Record<string, unknown> | null;
  grammarAnalysis: Record<string, unknown> | null;
  transitionAnalysis: Record<string, unknown> | null;
  promptAnalysis: Record<string, unknown> | null;
  previousCoachSynthesis: Record<string, unknown> | null;
  hasAssignmentPrompt: boolean;
}

function buildCoachSynthesisPrompt(input: SynthesisInput): string {
  const sections: string[] = [];

  sections.push(`Draft number: ${input.draftNumber}`);
  sections.push(`Has assignment prompt: ${input.hasAssignmentPrompt}`);

  if (input.evaluation) {
    sections.push(`## Trait Evaluation\n${JSON.stringify(input.evaluation, null, 2)}`);
  } else {
    sections.push('## Trait Evaluation\nNot yet available.');
  }

  if (input.grammarAnalysis) {
    sections.push(`## Grammar Analysis\n${JSON.stringify(input.grammarAnalysis, null, 2)}`);
  } else {
    sections.push('## Grammar Analysis\nNot yet available.');
  }

  if (input.transitionAnalysis) {
    sections.push(`## Transition Analysis\n${JSON.stringify(input.transitionAnalysis, null, 2)}`);
  } else {
    sections.push('## Transition Analysis\nNot yet available.');
  }

  if (input.hasAssignmentPrompt && input.promptAnalysis) {
    sections.push(`## Prompt Adherence Analysis\n${JSON.stringify(input.promptAnalysis, null, 2)}`);
  } else if (input.hasAssignmentPrompt) {
    sections.push('## Prompt Adherence Analysis\nNot yet available.');
  } else {
    sections.push('## Prompt Adherence Analysis\nNo assignment prompt provided — omit the "prompt" report from reportSummaries.');
  }

  if (input.previousCoachSynthesis) {
    sections.push(`## Previous Draft Coach Synthesis (for progress comparison)\n${JSON.stringify(input.previousCoachSynthesis, null, 2)}`);
  } else if (input.draftNumber > 1) {
    sections.push('## Previous Draft Coach Synthesis\nNot available — calculate progress from current data only.');
  }

  sections.push(`Produce a coaching synthesis JSON. ${input.draftNumber === 1 ? 'This is draft 1 — readiness must be "keep_going". improvements must be null.' : 'Compare to previous data and note improvements.'}`);

  return sections.join('\n\n');
}

export async function synthesizeCoachForDraft(
  apiKey: string,
  draftRef: DocumentReference,
): Promise<void> {
  // Poll until all expected analyses are present
  let data: FirebaseFirestore.DocumentData | undefined;
  for (let attempt = 0; attempt < 12; attempt++) {
    const snap = await draftRef.get();
    if (!snap.exists) return;
    data = snap.data()!;
    const hasEval = !!data.evaluation;
    const hasGrammar = !!data.grammarAnalysis;
    const hasTransitions = !!data.transitionAnalysis;
    // Prompt analysis only expected if essay has a prompt
    const essayRef = draftRef.parent.parent!;
    const essaySnap = await essayRef.get();
    const needsPrompt = !!essaySnap.data()?.assignmentPrompt?.trim();
    const hasPrompt = !needsPrompt || !!data.promptAnalysis;
    if (hasEval && hasGrammar && hasTransitions && hasPrompt) break;
    logger.info('Waiting for analyses before synthesis', {
      attempt, hasEval, hasGrammar, hasTransitions, hasPrompt,
    });
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (!data) return;

  // Read essay doc for assignmentPrompt
  const essayRef = draftRef.parent.parent!;
  const essaySnap = await essayRef.get();
  const hasAssignmentPrompt = !!essaySnap.data()?.assignmentPrompt?.trim();

  // Try to get previous draft's coach synthesis
  let previousCoachSynthesis: Record<string, unknown> | null = null;
  if (data.draftNumber > 1) {
    const prevDrafts = await draftRef.parent
      .where('draftNumber', '==', data.draftNumber - 1)
      .limit(1)
      .get();
    if (!prevDrafts.empty) {
      previousCoachSynthesis = prevDrafts.docs[0].data()?.coachSynthesis || null;
    }
  }

  const input: SynthesisInput = {
    draftNumber: data.draftNumber,
    evaluation: data.evaluation || null,
    grammarAnalysis: data.grammarAnalysis || null,
    transitionAnalysis: data.transitionAnalysis || null,
    promptAnalysis: data.promptAnalysis || null,
    previousCoachSynthesis,
    hasAssignmentPrompt,
  };

  const userPrompt = buildCoachSynthesisPrompt(input);

  await draftRef.update({
    coachSynthesisStatus: { stage: 'thinking', message: 'Preparing coaching summary...' },
  });

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: MODEL,
    contents: userPrompt,
    config: {
      systemInstruction: COACH_SYNTHESIS_SYSTEM,
      responseMimeType: 'application/json',
      responseSchema: COACH_SYNTHESIS_SCHEMA,
    },
  });

  let text: string;
  try {
    text = response.text ?? '';
  } catch (e) {
    throw new Error(`Gemini response inaccessible: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!text) throw new Error('Gemini returned empty response for coach synthesis');

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let synthesis: any;
  try {
    synthesis = JSON.parse(text);
  } catch (e) {
    throw new Error(`Coach synthesis JSON parse failed: ${e instanceof Error ? e.message : String(e)}`);
  }

  // If no assignment prompt, filter out the prompt report summary
  if (!hasAssignmentPrompt) {
    synthesis.reportSummaries = synthesis.reportSummaries.filter(
      (r: { key: string }) => r.key !== 'prompt'
    );
  }

  await draftRef.update({
    coachSynthesis: synthesis,
    coachSynthesisStatus: null,
  });

  logger.info('Coach synthesis complete', {
    readiness: synthesis.readiness,
    recommended: synthesis.recommendedReport,
  });
}
