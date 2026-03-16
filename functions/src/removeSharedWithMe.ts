import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';

export const removeSharedWithMe = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const callerEmail = request.auth.token.email;
  if (!callerEmail || !(await isEmailAllowed(callerEmail))) {
    throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
  }

  const { ownerUid } = request.data;
  if (!ownerUid || typeof ownerUid !== 'string') {
    throw new HttpsError('invalid-argument', 'ownerUid is required');
  }

  const db = getFirestore();
  const callerUid = request.auth.uid;

  // Try resolved share first (keyed by ownerUid_callerUid)
  const shareId = `${ownerUid}_${callerUid}`;
  const shareDoc = await db.doc(`shares/${shareId}`).get();

  if (shareDoc.exists) {
    await db.doc(`shares/${shareId}`).delete();
    return { success: true };
  }

  // Try pending share (matched by ownerUid + callerEmail)
  const normalizedEmail = callerEmail.toLowerCase();
  const pendingShares = await db.collection('shares')
    .where('ownerUid', '==', ownerUid)
    .where('sharedWithEmail', '==', normalizedEmail)
    .where('pending', '==', true)
    .limit(1)
    .get();

  if (!pendingShares.empty) {
    await pendingShares.docs[0].ref.delete();
    return { success: true };
  }

  throw new HttpsError('not-found', 'No active share from this user');
});
