/**
 * recordGoldLabel onCall (Eval Cockpit, Task 5).
 *
 * Lets an admin attach a human "gold label" verdict (A / B / tie, with an
 * optional note) to a single routed item inside an `evalRuns/{runId}` run.
 * The label is written onto the item doc itself (`goldLabel`) and mirrored
 * into a flat `evalGoldLabels` collection so downstream analysis can query
 * labels across runs without walking every run's items subcollection.
 *
 * Both writes happen in a single atomic `WriteBatch`, and the mirror doc
 * uses the deterministic id `${runId}_${itemId}` (not an auto-id) so
 * relabeling the same item upserts the same mirror row instead of appending
 * a duplicate, and a failure on either write leaves neither applied.
 *
 * No secrets/model calls here — this is pure Firestore read/write behind the
 * same auth + allowlist + admin gate as `startEvalRun`.
 */
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';
import { isEmailAdmin } from './admins';

const VALID_WINNERS = ['A', 'B', 'tie'] as const;
type Winner = (typeof VALID_WINNERS)[number];

export const recordGoldLabel = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const email = request.auth.token.email;
  if (!email || !(await isEmailAllowed(email))) {
    throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
  }
  if (!(await isEmailAdmin(email))) {
    throw new HttpsError('permission-denied', 'This action requires admin access');
  }

  const { runId, itemId, winner, note } = request.data ?? {};

  if (typeof runId !== 'string' || runId.length === 0) {
    throw new HttpsError('invalid-argument', 'runId is required.');
  }
  if (typeof itemId !== 'string' || itemId.length === 0) {
    throw new HttpsError('invalid-argument', 'itemId is required.');
  }
  if (typeof winner !== 'string' || !VALID_WINNERS.includes(winner as Winner)) {
    throw new HttpsError('invalid-argument', `winner must be one of ${VALID_WINNERS.join(', ')}.`);
  }
  if (note !== undefined && typeof note !== 'string') {
    throw new HttpsError('invalid-argument', 'note must be a string if present.');
  }

  const db = getFirestore();

  const runRef = db.collection('evalRuns').doc(runId);
  const runDoc = await runRef.get();
  if (!runDoc.exists) {
    throw new HttpsError('not-found', `Eval run ${runId} not found`);
  }

  const itemRef = runRef.collection('items').doc(itemId);
  const itemDoc = await itemRef.get();
  if (!itemDoc.exists) {
    throw new HttpsError('not-found', `Item ${itemId} not found in run ${runId}`);
  }

  const runData = runDoc.data() ?? {};
  if (typeof runData.report !== 'string') {
    throw new HttpsError(
      'failed-precondition',
      `Eval run ${runId} (evalRuns/${runId}) is missing a valid string "report" field; cannot record gold label mirror.`
    );
  }

  const ts = new Date().toISOString();
  const goldLabel = {
    winner: winner as Winner,
    ...(note !== undefined ? { note } : {}),
    ts,
    by: email,
  };

  const batch = db.batch();
  batch.update(itemRef, { goldLabel });

  const mirrorRef = db.collection('evalGoldLabels').doc(`${runId}_${itemId}`);
  batch.set(mirrorRef, {
    runId,
    itemId,
    report: runData.report,
    winner: winner as Winner,
    ...(note !== undefined ? { note } : {}),
    ts,
    by: email,
  });

  await batch.commit();

  return { ok: true };
});
