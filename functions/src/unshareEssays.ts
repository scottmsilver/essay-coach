import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';
import { emailHash } from './emailHash';

export const unshareEssays = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const callerEmail = request.auth.token.email;
  if (!callerEmail || !(await isEmailAllowed(callerEmail))) {
    throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
  }

  const { email } = request.data;
  if (!email || typeof email !== 'string' || email.trim().length === 0) {
    throw new HttpsError('invalid-argument', 'Email is required');
  }

  const db = getFirestore();
  const callerUid = request.auth.uid;
  const normalizedEmail = email.trim().toLowerCase();

  // Try to find a resolved share (recipient has an account)
  const usersSnapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (!usersSnapshot.empty) {
    const recipientUid = usersSnapshot.docs[0].id;
    const shareId = `${callerUid}_${recipientUid}`;
    const shareDoc = await db.doc(`shares/${shareId}`).get();

    if (shareDoc.exists) {
      await db.doc(`shares/${shareId}`).delete();
      return { success: true };
    }
  }

  // Try to find a pending share (recipient has no account yet)
  const pendingShareId = `${callerUid}_pending_${emailHash(normalizedEmail)}`;
  const pendingDoc = await db.doc(`shares/${pendingShareId}`).get();

  if (pendingDoc.exists) {
    await db.doc(`shares/${pendingShareId}`).delete();
    return { success: true };
  }

  throw new HttpsError('not-found', 'No active share with this email');
});
