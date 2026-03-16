import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';
import { emailHash } from './emailHash';

export const shareEssays = onCall(async (request) => {
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

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail === callerEmail.toLowerCase()) {
    throw new HttpsError('invalid-argument', 'Cannot share with yourself');
  }

  const db = getFirestore();
  const callerUid = request.auth.uid;

  // Look up recipient by email
  const usersSnapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (!usersSnapshot.empty) {
    // Recipient already has an account — create a resolved share
    const recipientDoc = usersSnapshot.docs[0];
    const recipientUid = recipientDoc.id;
    const recipientEmail = recipientDoc.data().email;

    // Check if share already exists
    const shareId = `${callerUid}_${recipientUid}`;
    const existingShare = await db.doc(`shares/${shareId}`).get();
    if (existingShare.exists) {
      throw new HttpsError('already-exists', 'Already shared with this user');
    }

    // Also check if a pending share exists for this email (shouldn't normally happen,
    // but clean it up if so)
    const pendingShareId = `${callerUid}_pending_${emailHash(normalizedEmail)}`;
    const pendingShare = await db.doc(`shares/${pendingShareId}`).get();
    if (pendingShare.exists) {
      await db.doc(`shares/${pendingShareId}`).delete();
    }

    // Create resolved share document
    await db.doc(`shares/${shareId}`).set({
      ownerUid: callerUid,
      ownerEmail: callerEmail.toLowerCase(),
      sharedWithUid: recipientUid,
      sharedWithEmail: recipientEmail,
      pending: false,
      createdAt: FieldValue.serverTimestamp(),
    });

    return { success: true, sharedWith: recipientEmail };
  }

  // Recipient does NOT have an account yet — create a pending share
  const pendingShareId = `${callerUid}_pending_${emailHash(normalizedEmail)}`;

  // Check if pending share already exists
  const existingPending = await db.doc(`shares/${pendingShareId}`).get();
  if (existingPending.exists) {
    throw new HttpsError('already-exists', 'Already shared with this email');
  }

  // Also check if a resolved share already exists (user might have been looked up differently)
  const existingResolved = await db.collection('shares')
    .where('ownerUid', '==', callerUid)
    .where('sharedWithEmail', '==', normalizedEmail)
    .limit(1)
    .get();
  if (!existingResolved.empty) {
    throw new HttpsError('already-exists', 'Already shared with this email');
  }

  await db.doc(`shares/${pendingShareId}`).set({
    ownerUid: callerUid,
    ownerEmail: callerEmail.toLowerCase(),
    sharedWithUid: null,
    sharedWithEmail: normalizedEmail,
    pending: true,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, sharedWith: normalizedEmail, pending: true };
});
