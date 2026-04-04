import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

/**
 * Build a Firestore reference to a draft document.
 * Centralizes the path template so it's not scattered across hooks.
 */
export function draftRef(uid: string, essayId: string, draftId: string) {
  return doc(db, `users/${uid}/essays/${essayId}/drafts/${draftId}`);
}

/**
 * Clear an analysis result and status, triggering a re-run.
 */
export async function clearAnalysis(
  uid: string,
  essayId: string,
  draftId: string,
  dataField: string,
  statusField: string,
) {
  const ref = draftRef(uid, essayId, draftId);
  await updateDoc(ref, { [dataField]: null, [statusField]: null });
}
