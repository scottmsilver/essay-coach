import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';

export type { CoherenceAnalysis, ParagraphAssessment, ThesisParagraph, CoherenceSummary, ParagraphRelation } from '../../shared/coherenceTypes';
import type { CoherenceAnalysis } from '../../shared/coherenceTypes';

export const COHERENCE_SYSTEM_PROMPT = `You are an expert writing coach helping high school and college students see whether each paragraph in their essay actually serves the thesis.

## Your job

You will receive a student's essay broken into paragraphs (one per blank-line block, indexed starting at 1). Your task:

1. **Identify the thesis.** Pick the single paragraph that contains the controlling idea — the central claim, position, or thematic anchor that the rest of the essay should serve. Quote the core claim in one sentence. Argumentative essays usually put it in paragraph 1; narratives often delay it; analytical essays sometimes restate it in the conclusion. Use judgment.

2. **Classify every other paragraph** against the thesis into exactly one of:
   - **supports** — develops, provides evidence for, or illustrates the thesis. This is the healthy default.
   - **contrasts_acknowledged** — presents a counterargument, opposing view, or complication, AND the student signals it on purpose ("Critics argue", "Although it might seem", "On the other hand", a clear pivot). Treat as a positive — counterarguments are good writing.
   - **contrasts_unacknowledged** — contradicts or undercuts the thesis with no signal that the student knows. A reader is left wondering whether the student forgot their own argument. This is a problem.
   - **off_topic** — neither supports nor contrasts the thesis. The student wandered. Probably a good idea that belongs in a different essay. This is a problem.

3. **Annotate each paragraph** with a short Socratic comment that helps the student see it themselves. Quote a 5-15 word phrase from the paragraph verbatim so the UI can anchor the comment to the text.

## Voice rules

- Socratic, not directive. Ask, don't tell.
- Specific, not generic. Cite the paragraph's actual content.
- Never rewrite for them.
- supports: brief, positive, name WHY it works.
- contrasts_acknowledged: positive — "good move," name what the counterargument adds.
- contrasts_unacknowledged: ask whether they meant to contradict their thesis here, or whether this paragraph belongs to a different argument.
- off_topic: ask what this paragraph IS about and whether it would land better in a different essay, or whether the thesis itself should widen to accommodate it.

## Important rules

- Index paragraphs from 1 using the same boundaries as the input.
- Do not classify the thesis paragraph itself — return its index in thesisParagraph but omit it from the paragraphs array.
- Quote text EXACTLY as it appears in the essay.
- Exactly one classification per non-thesis paragraph.`;

const RELATION_ENUM = ['supports', 'contrasts_acknowledged', 'contrasts_unacknowledged', 'off_topic'];

export const COHERENCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    thesisParagraph: {
      type: 'object' as const,
      properties: {
        index: { type: 'number' as const },
        claim: { type: 'string' as const },
      },
      required: ['index', 'claim'],
    },
    paragraphs: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          index:      { type: 'number' as const },
          relation:   { type: 'string' as const, enum: RELATION_ENUM },
          quotedText: { type: 'string' as const },
          comment:    { type: 'string' as const },
        },
        required: ['index', 'relation', 'quotedText', 'comment'],
      },
    },
    summary: {
      type: 'object' as const,
      properties: {
        totalParagraphs:           { type: 'number' as const },
        supports:                  { type: 'number' as const },
        contrastsAcknowledged:     { type: 'number' as const },
        contrastsUnacknowledged:   { type: 'number' as const },
        offTopic:                  { type: 'number' as const },
      },
      required: ['totalParagraphs', 'supports', 'contrastsAcknowledged', 'contrastsUnacknowledged', 'offTopic'],
    },
  },
  required: ['thesisParagraph', 'paragraphs', 'summary'],
};

export interface CoherenceInput {
  writingType: string;
  assignmentPrompt: string;
  content: string;
}

export function buildCoherencePrompt(input: CoherenceInput): string {
  return `Analyze the following ${input.writingType} essay for off-topic or self-contradicting paragraphs.

Assignment prompt (context only — your job is to assess thesis coherence, not prompt fit):
${input.assignmentPrompt || '(none provided)'}

Essay:
${input.content}

Return the thesis paragraph and a relation classification for every other paragraph.`;
}

export async function analyzeCoherenceWithGemini(
  apiKey: string,
  input: CoherenceInput,
  progressRef?: DocumentReference,
): Promise<CoherenceAnalysis> {
  const outputText = await streamGeminiJson({
    apiKey,
    contents: buildCoherencePrompt(input),
    systemInstruction: COHERENCE_SYSTEM_PROMPT,
    responseSchema: COHERENCE_SCHEMA,
    progressRef,
    statusField: 'coherenceStatus',
    generatingMessage: 'Checking thesis coherence...',
  });
  return JSON.parse(outputText) as CoherenceAnalysis;
}
