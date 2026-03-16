import { user } from 'firebase-functions/v1/auth';
import { getFirestore } from 'firebase-admin/firestore';

export const deleteAccount = user().onDelete(async (userRecord) => {
  const db = getFirestore();
  const uid = userRecord.uid;

  // Delete shares where this user is the owner
  const ownerShares = await db.collection('shares')
    .where('ownerUid', '==', uid)
    .get();
  const batch1 = db.batch();
  ownerShares.docs.forEach((doc) => batch1.delete(doc.ref));
  if (!ownerShares.empty) await batch1.commit();

  // Delete shares where this user is the recipient
  const recipientShares = await db.collection('shares')
    .where('sharedWithUid', '==', uid)
    .get();
  const batch2 = db.batch();
  recipientShares.docs.forEach((doc) => batch2.delete(doc.ref));
  if (!recipientShares.empty) await batch2.commit();

  // Delete user document and all subcollections
  const userDocRef = db.doc(`users/${uid}`);
  await db.recursiveDelete(userDocRef);
});
