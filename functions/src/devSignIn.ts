import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';

const DEV_USERS: Record<string, { uid: string; displayName: string }> = {
  'dev-alice@essaycoach.test': { uid: 'dev-alice', displayName: 'Alice (Dev)' },
  'dev-bob@essaycoach.test': { uid: 'dev-bob', displayName: 'Bob (Dev)' },
};

export const devSignIn = onCall(async (request) => {
  const { email } = request.data;
  if (!email || typeof email !== 'string') {
    throw new HttpsError('invalid-argument', 'Email is required');
  }

  const devUser = DEV_USERS[email];
  if (!devUser) {
    throw new HttpsError('permission-denied', 'Not a valid dev user');
  }

  const auth = getAuth();
  const db = getFirestore();

  // Ensure the user exists in Firebase Auth
  try {
    await auth.getUser(devUser.uid);
  } catch {
    await auth.createUser({
      uid: devUser.uid,
      email,
      displayName: devUser.displayName,
    });
  }

  // Ensure user profile exists in Firestore
  const userDoc = await db.doc(`users/${devUser.uid}`).get();
  if (!userDoc.exists) {
    await db.doc(`users/${devUser.uid}`).set({
      displayName: devUser.displayName,
      email,
      createdAt: FieldValue.serverTimestamp(),
    });
  }

  // Ensure dev emails are on the allowlist
  const allowlistDoc = await db.doc('config/allowlist').get();
  const existingEmails: string[] = allowlistDoc.data()?.emails ?? [];
  const devEmails = Object.keys(DEV_USERS);
  const missing = devEmails.filter((e) => !existingEmails.includes(e));
  if (missing.length > 0) {
    await db.doc('config/allowlist').update({
      emails: [...existingEmails, ...missing],
    });
  }

  // Mint a custom token
  const token = await auth.createCustomToken(devUser.uid);
  return { token };
});
