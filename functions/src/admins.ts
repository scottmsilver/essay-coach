import { getFirestore } from 'firebase-admin/firestore';

export async function isEmailAdmin(email: string | undefined): Promise<boolean> {
  if (!email) return false;
  const db = getFirestore();
  const doc = await db.doc('config/admins').get();
  if (!doc.exists) return false;
  const emails: string[] = doc.data()?.emails ?? [];
  return emails.includes(email.toLowerCase());
}
