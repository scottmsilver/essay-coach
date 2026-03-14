import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

initializeApp({ credential: applicationDefault() });
const db = getFirestore();

async function seed() {
  await db.doc('config/allowlist').set({
    emails: ['user1@example.com', 'user2@example.com', 'user3@example.com'],
  });
  console.log('Allowlist seeded successfully.');
}

seed().catch(console.error);
