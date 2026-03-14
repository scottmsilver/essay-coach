import { getFirestore } from 'firebase-admin/firestore';

export async function isEmailAllowed(email: string): Promise<boolean> {
  const db = getFirestore();
  const doc = await db.doc('config/allowlist').get();
  if (!doc.exists) return false;
  const emails: string[] = doc.data()?.emails ?? [];
  return emails.includes(email.toLowerCase());
}
