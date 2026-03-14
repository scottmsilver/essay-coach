import { user } from 'firebase-functions/v1/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const deleteAccount = user().onDelete(async (userRecord) => {
  const db = getFirestore();
  const userDocRef = db.doc(`users/${userRecord.uid}`);
  await db.recursiveDelete(userDocRef);
});
