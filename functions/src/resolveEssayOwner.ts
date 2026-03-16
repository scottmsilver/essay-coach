import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Resolves the essay owner UID for cloud function operations.
 * If ownerUid is provided and differs from callerUid, verifies a share exists.
 * Returns the resolved owner UID to use for Firestore path construction.
 */
export async function resolveEssayOwner(
  callerUid: string,
  ownerUid?: string,
): Promise<string> {
  if (!ownerUid || ownerUid === callerUid) {
    return callerUid;
  }

  const db = getFirestore();
  const shareDoc = await db.doc(`shares/${ownerUid}_${callerUid}`).get();
  if (!shareDoc.exists) {
    throw new HttpsError('permission-denied', 'You do not have access to this user\'s essays');
  }

  return ownerUid;
}
