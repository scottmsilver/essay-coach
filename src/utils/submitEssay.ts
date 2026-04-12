import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export const FUNCTION_TIMEOUT = 180_000;

/**
 * Fire all 3 analyses in parallel (fire-and-forget).
 * Each call catches its own error so one failure doesn't block the others.
 */
export function fireAllAnalyses(essayId: string, draftId: string, ownerUid?: string, teacherCriteria?: string | null) {
  const evaluate = httpsCallable(functions, 'evaluateEssay', { timeout: FUNCTION_TIMEOUT });
  const grammar = httpsCallable(functions, 'analyzeGrammar', { timeout: FUNCTION_TIMEOUT });
  const transitions = httpsCallable(functions, 'analyzeTransitions', { timeout: FUNCTION_TIMEOUT });
  const promptAdherence = httpsCallable(functions, 'analyzePromptAdherence', { timeout: FUNCTION_TIMEOUT });

  const args = { essayId, draftId, ownerUid };
  evaluate(args).catch((err) => console.error('Evaluation failed:', err));
  grammar(args).catch((err) => console.error('Grammar failed:', err));
  transitions(args).catch((err) => console.error('Transitions failed:', err));
  promptAdherence(args).catch((err) => console.error('Prompt adherence failed:', err));

  if (teacherCriteria?.trim()) {
    const criteria = httpsCallable(functions, 'analyzeCriteria', { timeout: FUNCTION_TIMEOUT });
    criteria(args).catch((err) => console.error('Criteria analysis failed:', err));
  }
}
