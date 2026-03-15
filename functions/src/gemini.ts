import { GoogleGenAI } from '@google/genai';
import { SYSTEM_PROMPT } from './prompt';
import type { DocumentReference } from 'firebase-admin/firestore';

const EVALUATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    traits: {
      type: 'object' as const,
      properties: Object.fromEntries(
        ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'].map(
          (trait) => [
            trait,
            {
              type: 'object' as const,
              properties: {
                score: { type: 'number' as const },
                feedback: { type: 'string' as const },
                revisionPriority: { type: 'number' as const, nullable: true },
                annotations: {
                  type: 'array' as const,
                  items: {
                    type: 'object' as const,
                    properties: {
                      quotedText: { type: 'string' as const },
                      comment: { type: 'string' as const },
                    },
                    required: ['quotedText', 'comment'],
                  },
                },
              },
              required: ['score', 'feedback', 'revisionPriority', 'annotations'],
            },
          ]
        )
      ),
      required: ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'],
    },
    overallFeedback: { type: 'string' as const },
    revisionPlan: { type: 'array' as const, items: { type: 'string' as const } },
    comparisonToPrevious: {
      type: 'object' as const,
      nullable: true,
      properties: {
        scoreChanges: { type: 'object' as const },
        improvements: { type: 'array' as const, items: { type: 'string' as const } },
        remainingIssues: { type: 'array' as const, items: { type: 'string' as const } },
      },
    },
  },
  required: ['traits', 'overallFeedback', 'revisionPlan', 'comparisonToPrevious'],
};

export async function evaluateWithGemini(
  apiKey: string,
  userPrompt: string,
  progressRef?: DocumentReference,
): Promise<Record<string, unknown>> {
  const ai = new GoogleGenAI({ apiKey });

  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.1-pro-preview',
    contents: userPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: EVALUATION_SCHEMA,
      thinkingConfig: { includeThoughts: true },
    },
  });

  let outputText = '';
  let stage: 'thinking' | 'generating' = 'thinking';
  let lastProgressWrite = 0;
  const PROGRESS_THROTTLE_MS = 2000;

  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.thought) {
        if (progressRef) {
          const now = Date.now();
          if (now - lastProgressWrite >= PROGRESS_THROTTLE_MS) {
            const lines = (part.text || '').trim().split('\n');
            const headline = lines[0]?.replace(/^\*+|\*+$/g, '').trim() || 'Thinking...';
            await progressRef.update({ evaluationStatus: { stage: 'thinking', message: headline } });
            lastProgressWrite = now;
          }
        }
      } else {
        if (stage === 'thinking') {
          stage = 'generating';
          if (progressRef) {
            await progressRef.update({ evaluationStatus: { stage: 'generating', message: 'Writing feedback...' } });
          }
        }
        outputText += part.text || '';
      }
    }
  }

  if (!outputText) {
    throw new Error('Gemini returned an empty response');
  }

  return JSON.parse(outputText);
}
