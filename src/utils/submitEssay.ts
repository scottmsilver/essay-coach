import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

/**
 * Fire all 3 analyses in parallel (fire-and-forget).
 * Each call catches its own error so one failure doesn't block the others.
 */
export function fireAllAnalyses(essayId: string, draftId: string, ownerUid?: string) {
  const evaluate = httpsCallable(functions, 'evaluateEssay', { timeout: 180000 });
  const grammar = httpsCallable(functions, 'analyzeGrammar', { timeout: 180000 });
  const transitions = httpsCallable(functions, 'analyzeTransitions', { timeout: 180000 });

  const args = { essayId, draftId, ownerUid };
  evaluate(args).catch((err) => console.error('Evaluation failed:', err));
  grammar(args).catch((err) => console.error('Grammar failed:', err));
  transitions(args).catch((err) => console.error('Transitions failed:', err));
}
