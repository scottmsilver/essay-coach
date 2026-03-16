import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

/**
 * Called after a new user signs in and their user doc is created.
 * Finds any pending shares addressed to this user's email and resolves them
 * by replacing the pending share doc with a resolved one keyed by UID.
 */
export const resolvePendingShares = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const callerEmail = request.auth.token.email;
  if (!callerEmail) {
    throw new HttpsError('failed-precondition', 'No email on auth token');
  }

  const db = getFirestore();
  const callerUid = request.auth.uid;
  const normalizedEmail = callerEmail.toLowerCase();

  // Find all pending shares for this email
  const pendingShares = await db.collection('shares')
    .where('sharedWithEmail', '==', normalizedEmail)
    .where('pending', '==', true)
    .get();

  if (pendingShares.empty) {
    return { resolved: 0 };
  }

  let resolved = 0;

  for (const pendingDoc of pendingShares.docs) {
    const data = pendingDoc.data();
    const ownerUid = data.ownerUid;
    const resolvedShareId = `${ownerUid}_${callerUid}`;

    // Check if a resolved share already exists (e.g., owner re-shared after user signed up)
    const existingResolved = await db.doc(`shares/${resolvedShareId}`).get();
    if (existingResolved.exists) {
      // Just delete the pending one
      await pendingDoc.ref.delete();
      continue;
    }

    // Atomically create resolved share and delete pending share
    const batch = db.batch();
    batch.set(db.doc(`shares/${resolvedShareId}`), {
      ownerUid: data.ownerUid,
      ownerEmail: data.ownerEmail,
      sharedWithUid: callerUid,
      sharedWithEmail: normalizedEmail,
      pending: false,
      createdAt: data.createdAt ?? FieldValue.serverTimestamp(),
    });
    batch.delete(pendingDoc.ref);
    await batch.commit();
    resolved++;
  }

  return { resolved };
});
