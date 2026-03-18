# Essay Sharing Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow a user to share their entire essay collection with another user via email, granting full read/write access to existing essays.

**Architecture:** Top-level `shares/{ownerUid}_{sharedWithUid}` Firestore collection with deterministic IDs. Cloud functions for share/unshare operations and a `resolveEssayOwner` helper added to existing functions. Frontend hooks compose own + shared essays into a merged list. New routes for shared essay views and a sharing management page.

**Tech Stack:** React 19, Firebase v12 (client), firebase-admin v13, firebase-functions v6, TypeScript 5.9, Vitest

**Spec:** `docs/superpowers/specs/2026-03-15-essay-sharing-design.md`

---

## Chunk 0: Dev Login Bypass (against real Firebase)

Works against the real Firebase project — no emulators. A `devSignIn` cloud function mints custom auth tokens for test users. Dev login buttons on the LoginPage let you switch between them. A seed script adds test emails to the real allowlist and creates their user profiles.

### Task 0A: Create devSignIn cloud function

**Files:**
- Create: `functions/src/devSignIn.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the devSignIn function**

This function mints a custom auth token for a hardcoded set of test emails. It requires no auth itself (the whole point is to get auth). Restricted to a small set of known dev emails.

```typescript
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
```

- [ ] **Step 2: Export from index.ts**

Add to `functions/src/index.ts`:

```typescript
export { devSignIn } from './devSignIn';
```

- [ ] **Step 3: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat: add devSignIn cloud function for test user auth
```

---

### Task 0B: Add dev login buttons to LoginPage

**Files:**
- Modify: `src/pages/LoginPage.tsx`

- [ ] **Step 1: Add dev login UI**

Replace the entire file:

```typescript
import { useAuth } from '../hooks/useAuth';
import { Navigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { functions, auth } from '../firebase';
import { useState } from 'react';

const DEV_USERS = [
  { email: 'dev-alice@essaycoach.test', label: 'Alice (Dev)' },
  { email: 'dev-bob@essaycoach.test', label: 'Bob (Dev)' },
];

export default function LoginPage() {
  const { user, loading, allowed, signIn, logOut } = useAuth();
  const [devLoading, setDevLoading] = useState(false);

  if (loading) return <div className="center">Loading...</div>;
  if (user && allowed) return <Navigate to="/" />;

  const handleDevSignIn = async (email: string) => {
    setDevLoading(true);
    try {
      const devSignIn = httpsCallable<{ email: string }, { token: string }>(functions, 'devSignIn');
      const result = await devSignIn({ email });
      await signInWithCustomToken(auth, result.data.token);
    } catch (err) {
      console.error('Dev sign-in failed:', err);
    } finally {
      setDevLoading(false);
    }
  };

  return (
    <div className="login-page">
      <h1>EssayCoach</h1>
      <p>Get feedback on your writing and improve through revision.</p>
      {user && allowed === false ? (
        <div className="access-denied">
          <p>You don't have access yet. Contact the administrator.</p>
          <button onClick={logOut}>Sign out</button>
        </div>
      ) : (
        <>
          <button className="google-sign-in" onClick={signIn}>
            Sign in with Google
          </button>
          {import.meta.env.DEV && (
            <div style={{ marginTop: 24, padding: 16, border: '1px dashed var(--color-text-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Dev Login</div>
              {DEV_USERS.map((u) => (
                <button
                  key={u.email}
                  onClick={() => handleDevSignIn(u.email)}
                  disabled={devLoading}
                  style={{ display: 'block', width: '100%', marginBottom: 8, padding: '8px 16px', cursor: 'pointer' }}
                >
                  {u.label}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
```

The dev login section is only visible when running `npm run dev` (Vite sets `import.meta.env.DEV` to true). In production builds it is tree-shaken out.

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add dev login buttons to LoginPage for testing
```

---

## Chunk 1: Data Model, Security Rules, and Backend Share Helper

### Task 1: Add Share type to frontend types

**Files:**
- Modify: `src/types.ts:158-172`

- [ ] **Step 1: Add Share and EssayListItem types**

Add after the `Essay` interface (line 166):

```typescript
export interface Share {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  sharedWithUid: string;
  sharedWithEmail: string;
  createdAt: Date;
}

export interface EssayListItem extends Essay {
  ownerUid: string;
  ownerEmail: string;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add Share and EssayListItem types
```

---

### Task 2: Update Firestore security rules

**Files:**
- Modify: `firestore.rules`

- [ ] **Step 1: Add isSharedWith helper and update rules**

Replace the entire `firestore.rules` with:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    function isSharedWith(uid) {
      return exists(/databases/$(database)/documents/shares/$(uid + '_' + request.auth.uid));
    }

    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;

      match /essays/{essayId} {
        allow read, write: if request.auth != null
          && (request.auth.uid == uid || isSharedWith(uid));

        match /drafts/{draftId} {
          allow read: if request.auth != null
            && (request.auth.uid == uid || isSharedWith(uid));
          allow create: if request.auth != null
            && (request.auth.uid == uid || isSharedWith(uid))
            && !("evaluation" in request.resource.data);
          allow update: if request.auth != null
            && (request.auth.uid == uid || isSharedWith(uid))
            && (!("evaluation" in request.resource.data)
                || (request.resource.data.diff(resource.data).affectedKeys()
                    .hasOnly(["revisionStage"])
                    && (request.resource.data.revisionStage is number
                        || request.resource.data.revisionStage == null)));
        }
      }
    }

    match /shares/{shareId} {
      allow read: if request.auth != null
        && (resource.data.ownerUid == request.auth.uid
            || resource.data.sharedWithUid == request.auth.uid);
      allow create, update, delete: if false;
    }

    match /config/{doc} {
      allow read: if request.auth != null;
      allow write: if false;
    }
  }
}
```

- [ ] **Step 2: Commit**

```
feat: add sharing support to Firestore security rules
```

---

### Task 3: Add Firestore indexes for shares collection

**Files:**
- Modify: `firestore.indexes.json`

- [ ] **Step 1: Add composite indexes**

```json
{
  "indexes": [
    {
      "collectionGroup": "shares",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "sharedWithUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "shares",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "ownerUid", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

- [ ] **Step 2: Commit**

```
feat: add Firestore indexes for shares collection
```

---

### Task 4: Create resolveEssayOwner helper in cloud functions

**Files:**
- Create: `functions/src/resolveEssayOwner.ts`

- [ ] **Step 1: Write the helper**

```typescript
import { getFirestore } from 'firebase-admin/firestore';
import { HttpsError } from 'firebase-functions/v2/https';

/**
 * Resolves the essay owner UID for cloud function operations.
 * If ownerUid is provided and differs from callerUid, verifies a share exists.
 * Returns the resolved owner UID to use for Firestore path construction.
 */
export async function resolveEssayOwner(
  callerUid: string,
  ownerUid?: string,
): Promise<string> {
  if (!ownerUid || ownerUid === callerUid) {
    return callerUid;
  }

  const db = getFirestore();
  const shareDoc = await db.doc(`shares/${ownerUid}_${callerUid}`).get();
  if (!shareDoc.exists) {
    throw new HttpsError('permission-denied', 'You do not have access to this user\'s essays');
  }

  return ownerUid;
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add resolveEssayOwner helper for share verification
```

---

### Task 5: Create shareEssays cloud function

**Files:**
- Create: `functions/src/shareEssays.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the shareEssays function**

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';

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

  if (usersSnapshot.empty) {
    throw new HttpsError('not-found', 'User not found. They must have signed in at least once.');
  }

  const recipientDoc = usersSnapshot.docs[0];
  const recipientUid = recipientDoc.id;
  const recipientEmail = recipientDoc.data().email;

  // Check if share already exists
  const shareId = `${callerUid}_${recipientUid}`;
  const existingShare = await db.doc(`shares/${shareId}`).get();
  if (existingShare.exists) {
    throw new HttpsError('already-exists', 'Already shared with this user');
  }

  // Create share document
  await db.doc(`shares/${shareId}`).set({
    ownerUid: callerUid,
    ownerEmail: callerEmail.toLowerCase(),
    sharedWithUid: recipientUid,
    sharedWithEmail: recipientEmail,
    createdAt: FieldValue.serverTimestamp(),
  });

  return { success: true, sharedWith: recipientEmail };
});
```

- [ ] **Step 2: Export from index.ts**

Add to `functions/src/index.ts`:

```typescript
export { shareEssays } from './shareEssays';
```

- [ ] **Step 3: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat: add shareEssays cloud function
```

---

### Task 6: Create unshareEssays cloud function

**Files:**
- Create: `functions/src/unshareEssays.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the unshareEssays function**

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';

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

  // Look up recipient by email
  const usersSnapshot = await db.collection('users')
    .where('email', '==', normalizedEmail)
    .limit(1)
    .get();

  if (usersSnapshot.empty) {
    throw new HttpsError('not-found', 'User not found');
  }

  const recipientUid = usersSnapshot.docs[0].id;
  const shareId = `${callerUid}_${recipientUid}`;
  const shareDoc = await db.doc(`shares/${shareId}`).get();

  if (!shareDoc.exists) {
    throw new HttpsError('not-found', 'No active share with this user');
  }

  await db.doc(`shares/${shareId}`).delete();
  return { success: true };
});
```

- [ ] **Step 2: Export from index.ts**

Add to `functions/src/index.ts`:

```typescript
export { unshareEssays } from './unshareEssays';
```

- [ ] **Step 3: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat: add unshareEssays cloud function
```

---

### Task 7: Create removeSharedWithMe cloud function

**Files:**
- Create: `functions/src/removeSharedWithMe.ts`
- Modify: `functions/src/index.ts`

- [ ] **Step 1: Write the removeSharedWithMe function**

```typescript
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { getFirestore } from 'firebase-admin/firestore';
import { isEmailAllowed } from './allowlist';

export const removeSharedWithMe = onCall(async (request) => {
  if (!request.auth) {
    throw new HttpsError('unauthenticated', 'Must be signed in');
  }

  const callerEmail = request.auth.token.email;
  if (!callerEmail || !(await isEmailAllowed(callerEmail))) {
    throw new HttpsError('permission-denied', 'Your account is not on the allowlist');
  }

  const { ownerUid } = request.data;
  if (!ownerUid || typeof ownerUid !== 'string') {
    throw new HttpsError('invalid-argument', 'ownerUid is required');
  }

  const db = getFirestore();
  const callerUid = request.auth.uid;
  const shareId = `${ownerUid}_${callerUid}`;
  const shareDoc = await db.doc(`shares/${shareId}`).get();

  if (!shareDoc.exists) {
    throw new HttpsError('not-found', 'No active share from this user');
  }

  await db.doc(`shares/${shareId}`).delete();
  return { success: true };
});
```

- [ ] **Step 2: Export from index.ts**

Add to `functions/src/index.ts`:

```typescript
export { removeSharedWithMe } from './removeSharedWithMe';
```

- [ ] **Step 3: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```
feat: add removeSharedWithMe cloud function
```

---

### Task 8: Add ownerUid support to resubmitDraft

**Files:**
- Modify: `functions/src/resubmitDraft.ts`

- [ ] **Step 1: Import resolveEssayOwner and update path construction**

At the top, add:
```typescript
import { resolveEssayOwner } from './resolveEssayOwner';
```

In the function body, after validation, change the UID resolution from:
```typescript
const uid = request.auth.uid;
```
to:
```typescript
const uid = await resolveEssayOwner(request.auth.uid, request.data.ownerUid);
```

The `essayId` destructure on line 23 stays unchanged (`const { essayId, content } = request.data;`). The `ownerUid` is accessed via `request.data.ownerUid` in the `resolveEssayOwner` call. Everything else stays the same — the `uid` variable already drives all path construction.

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add ownerUid support to resubmitDraft for shared essays
```

---

### Task 9: Add ownerUid support to analyzeTransitions

**Files:**
- Modify: `functions/src/analyzeTransitions.ts`

- [ ] **Step 1: Import resolveEssayOwner and update path construction**

Add import:
```typescript
import { resolveEssayOwner } from './resolveEssayOwner';
```

The existing destructure on line 22 (`const { essayId, draftId } = request.data;`) stays unchanged. The `ownerUid` is accessed via `request.data.ownerUid` in the resolve call.

Change the UID resolution from:
```typescript
const uid = request.auth.uid;
```
to:
```typescript
const uid = await resolveEssayOwner(request.auth.uid, request.data.ownerUid);
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add ownerUid support to analyzeTransitions for shared essays
```

---

### Task 10: Add ownerUid support to analyzeGrammar

**Files:**
- Modify: `functions/src/analyzeGrammar.ts`

- [ ] **Step 1: Import resolveEssayOwner and update path construction**

Add import:
```typescript
import { resolveEssayOwner } from './resolveEssayOwner';
```

The existing destructure on line 22 (`const { essayId, draftId } = request.data;`) stays unchanged. The `ownerUid` is accessed via `request.data.ownerUid` in the resolve call.

Change the UID resolution from:
```typescript
const uid = request.auth.uid;
```
to:
```typescript
const uid = await resolveEssayOwner(request.auth.uid, request.data.ownerUid);
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add ownerUid support to analyzeGrammar for shared essays
```

---

### Task 11: Update deleteAccount to clean up shares

**Files:**
- Modify: `functions/src/deleteAccount.ts`

- [ ] **Step 1: Add share cleanup**

Replace the entire file:

```typescript
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
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader/functions && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: clean up share documents on account deletion
```

---

## Chunk 2: Frontend Hooks

### Task 12: Create useSharedWithMe hook

**Files:**
- Create: `src/hooks/useSharedWithMe.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

interface SharedWithMeEntry {
  ownerUid: string;
  ownerEmail: string;
}

export function useSharedWithMe() {
  const { user } = useAuth();
  const [shares, setShares] = useState<SharedWithMeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'shares'),
      where('sharedWithUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setShares(snapshot.docs.map((doc) => ({
        ownerUid: doc.data().ownerUid,
        ownerEmail: doc.data().ownerEmail,
      })));
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  return { shares, loading };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add useSharedWithMe hook
```

---

### Task 13: Create useMyShares hook

**Files:**
- Create: `src/hooks/useMyShares.ts`

- [ ] **Step 1: Write the hook**

```typescript
import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

interface MyShareEntry {
  sharedWithUid: string;
  sharedWithEmail: string;
}

export function useMyShares() {
  const { user } = useAuth();
  const [shares, setShares] = useState<MyShareEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'shares'),
      where('ownerUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setShares(snapshot.docs.map((doc) => ({
        sharedWithUid: doc.data().sharedWithUid,
        sharedWithEmail: doc.data().sharedWithEmail,
      })));
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  return { shares, loading };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add useMyShares hook
```

---

### Task 14: Update useEssays to include shared essays

**Files:**
- Modify: `src/hooks/useEssays.ts`

- [ ] **Step 1: Rewrite useEssays to merge own + shared essays**

Replace the entire file:

```typescript
import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { useSharedWithMe } from './useSharedWithMe';
import type { Essay, EssayListItem } from '../types';

function parseEssayDoc(doc: any, ownerUid: string, ownerEmail: string): EssayListItem {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate() ?? new Date(),
    updatedAt: data.updatedAt?.toDate() ?? new Date(),
    ownerUid,
    ownerEmail,
  } as EssayListItem;
}

export function useEssays() {
  const { user } = useAuth();
  const { shares, loading: sharesLoading } = useSharedWithMe();
  const [ownEssays, setOwnEssays] = useState<EssayListItem[]>([]);
  const [sharedEssaysByOwner, setSharedEssaysByOwner] = useState<Record<string, EssayListItem[]>>({});
  const [ownLoading, setOwnLoading] = useState(true);
  const [sharedLoadingCount, setSharedLoadingCount] = useState(0);
  const activeListeners = useRef<Record<string, () => void>>({});
  const resolvedOwners = useRef<Set<string>>(new Set());

  // Own essays listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/essays`), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOwnEssays(snapshot.docs.map((doc) =>
        parseEssayDoc(doc, user.uid, user.email ?? '')
      ));
      setOwnLoading(false);
    });
    return unsubscribe;
  }, [user]);

  // Teardown all shared listeners on unmount only
  useEffect(() => {
    return () => {
      Object.values(activeListeners.current).forEach((unsub) => unsub());
      activeListeners.current = {};
      resolvedOwners.current.clear();
    };
  }, []);

  // Shared essays listeners — diff against current listeners
  useEffect(() => {
    if (sharesLoading) return;

    const currentOwnerUids = new Set(shares.map((s) => s.ownerUid));
    const activeOwnerUids = new Set(Object.keys(activeListeners.current));

    // Remove listeners for owners no longer shared
    for (const uid of activeOwnerUids) {
      if (!currentOwnerUids.has(uid)) {
        activeListeners.current[uid]();
        delete activeListeners.current[uid];
        resolvedOwners.current.delete(uid);
        setSharedEssaysByOwner((prev) => {
          const next = { ...prev };
          delete next[uid];
          return next;
        });
      }
    }

    // Add listeners for new owners
    for (const share of shares) {
      if (activeListeners.current[share.ownerUid]) continue;
      setSharedLoadingCount((c) => c + 1);

      const q = query(
        collection(db, `users/${share.ownerUid}/essays`),
        orderBy('updatedAt', 'desc'),
      );
      const ownerUid = share.ownerUid;
      const ownerEmail = share.ownerEmail;
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          setSharedEssaysByOwner((prev) => ({
            ...prev,
            [ownerUid]: snapshot.docs.map((doc) =>
              parseEssayDoc(doc, ownerUid, ownerEmail)
            ),
          }));
          // Only decrement loading count on the first snapshot from this owner
          if (!resolvedOwners.current.has(ownerUid)) {
            resolvedOwners.current.add(ownerUid);
            setSharedLoadingCount((c) => Math.max(0, c - 1));
          }
        },
        (error) => {
          console.error(`Failed to load essays for shared user ${ownerUid}:`, error);
          if (!resolvedOwners.current.has(ownerUid)) {
            resolvedOwners.current.add(ownerUid);
            setSharedLoadingCount((c) => Math.max(0, c - 1));
          }
        },
      );
      activeListeners.current[ownerUid] = unsubscribe;
    }
  }, [shares, sharesLoading]);

  // Merge and sort
  const allSharedEssays = Object.values(sharedEssaysByOwner).flat();
  const essays = [...ownEssays, ...allSharedEssays].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );

  const loading = ownLoading || sharesLoading || sharedLoadingCount > 0;

  return { essays, loading };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: merge shared essays into useEssays hook
```

---

### Task 15: Update useEssay to accept ownerUid

**Files:**
- Modify: `src/hooks/useEssay.ts`

- [ ] **Step 1: Add ownerUid parameter**

Replace the entire file:

```typescript
import { useState, useEffect } from 'react';
import { doc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import type { Essay, Draft } from '../types';

export function useEssay(essayId: string | undefined, ownerUid?: string) {
  const { user } = useAuth();
  const [essay, setEssay] = useState<Essay | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !essayId) return;
    const uid = ownerUid ?? user.uid;
    const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
    const unsubEssay = onSnapshot(essayRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setEssay({ id: snapshot.id, ...data,
          createdAt: data.createdAt?.toDate() ?? new Date(),
          updatedAt: data.updatedAt?.toDate() ?? new Date(),
        } as Essay);
      } else {
        setEssay(null);
        setLoading(false);
      }
    });
    const draftsQuery = query(
      collection(db, `users/${uid}/essays/${essayId}/drafts`),
      orderBy('draftNumber', 'desc')
    );
    const unsubDrafts = onSnapshot(draftsQuery, (snapshot) => {
      const result: Draft[] = snapshot.docs.map((d) => ({
        id: d.id, ...d.data(), submittedAt: d.data().submittedAt?.toDate() ?? new Date(),
      })) as Draft[];
      setDrafts(result);
      setLoading(false);
    });
    return () => { unsubEssay(); unsubDrafts(); };
  }, [user, essayId, ownerUid]);

  return { essay, drafts, loading };
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add ownerUid parameter to useEssay hook
```

---

## Chunk 3: Frontend Pages and Routing

### Task 16: Update HomePage to show shared essay badges

**Files:**
- Modify: `src/pages/HomePage.tsx`

- [ ] **Step 1: Update HomePage to use EssayListItem and show badges**

Replace the entire file:

```typescript
import { Link } from 'react-router-dom';
import { useEssays } from '../hooks/useEssays';
import { useAuth } from '../hooks/useAuth';

export default function HomePage() {
  const { essays, loading } = useEssays();
  const { user } = useAuth();

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essays...</p></div>;

  if (essays.length === 0) {
    return (
      <div className="empty-state">
        <h2>Welcome to EssayCoach</h2>
        <p>Submit your first essay to get feedback and start improving your writing.</p>
        <Link to="/new" className="btn-primary">Write Your First Essay</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>My Essays</h2>
        <Link to="/new" className="btn-primary">New Essay</Link>
      </div>
      <ul className="essay-list">
        {essays.map((essay) => {
          const isShared = essay.ownerUid !== user?.uid;
          const essayUrl = isShared
            ? `/user/${essay.ownerUid}/essay/${essay.id}`
            : `/essay/${essay.id}`;
          return (
            <Link key={`${essay.ownerUid}_${essay.id}`} to={essayUrl} className="essay-list-item">
              <div>
                <strong>{essay.title}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {essay.writingType} · Draft {essay.currentDraftNumber}
                  {isShared && (
                    <span style={{ marginLeft: 8, color: 'var(--color-accent)', fontStyle: 'italic' }}>
                      Shared by {essay.ownerEmail}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {essay.updatedAt.toLocaleDateString()}
              </div>
            </Link>
          );
        })}
      </ul>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: show shared essay badges on HomePage
```

---

### Task 17: Update EssayPage to support ownerUid from URL

**Files:**
- Modify: `src/pages/EssayPage.tsx`

- [ ] **Step 1: Read ownerUid from params and pass to hooks/functions**

At the top of the component, update the params destructure (line 16):

```typescript
const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
```

Update the useEssay call (line 17):

```typescript
const { essay, drafts, loading } = useEssay(essayId, ownerUid);
```

Update the `handleTransitionsTab` callable (line 57-58) to pass ownerUid:

```typescript
await analyzeTransitions({ essayId: essayId!, draftId: activeDraft_.id, ownerUid });
```

Update the `handleGrammarTab` callable (line 80-81) to pass ownerUid:

```typescript
await analyzeGrammar({ essayId: essayId!, draftId: activeDraft_.id, ownerUid });
```

Disable the retry button for shared essays — the `handleRetry` function calls `submitEssay` which creates a NEW essay (not a retry). For shared essays, only the owner should retry. In the error/retry UI block (around line 138-152), wrap the retry button:

```typescript
{!ownerUid && retryCount < 3 ? (
  <button onClick={handleRetry} className="btn-primary" style={{ marginTop: 12 }} disabled={retrying}>
    {retrying ? 'Retrying...' : 'Retry'}
  </button>
) : ownerUid ? (
  <p style={{ marginTop: 8 }}>Only the essay owner can retry evaluation.</p>
) : (
  <p style={{ marginTop: 8 }}>Maximum retries reached. Please try again later.</p>
)}
```

Update the "Start Revising" link (line 167):

```typescript
{isLatestDraft && (
  <Link
    to={ownerUid ? `/user/${ownerUid}/essay/${essayId}/revise` : `/essay/${essayId}/revise`}
    className="btn-primary"
  >
    Start Revising
  </Link>
)}
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add ownerUid support to EssayPage for shared essays
```

---

### Task 18: Update RevisionPage to support ownerUid from URL

**Files:**
- Modify: `src/pages/RevisionPage.tsx`

- [ ] **Step 1: Read ownerUid from params and pass to hooks/functions**

Update the params destructure (line 11):

```typescript
const { essayId, ownerUid } = useParams<{ essayId: string; ownerUid?: string }>();
```

Update the useEssay call (line 13):

```typescript
const { essay, drafts, loading } = useEssay(essayId, ownerUid);
```

Update the resubmitDraft call in handleResubmit (line 62):

```typescript
await resubmitDraft({ essayId, content, ownerUid });
```

Update the navigate after resubmit (line 63-64):

```typescript
navigate(ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`);
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add ownerUid support to RevisionPage for shared essays
```

---

### Task 19: Add shared essay routes to App.tsx

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add new routes for shared essays and sharing page**

Add the SharingPage import at the top:

```typescript
import SharingPage from './pages/SharingPage';
```

Add routes inside the protected route group (after the `/progress` route, before `</Route>`):

```typescript
<Route path="/user/:ownerUid/essay/:essayId" element={<EssayPage />} />
<Route path="/user/:ownerUid/essay/:essayId/revise" element={<RevisionPage />} />
<Route path="/sharing" element={<SharingPage />} />
```

- [ ] **Step 2: Verify build**

This will fail until SharingPage exists — that's expected. Move to next task.

- [ ] **Step 3: Commit with SharingPage (after Task 20)**

---

### Task 20: Create SharingPage

**Files:**
- Create: `src/pages/SharingPage.tsx`

- [ ] **Step 1: Write the SharingPage component**

```typescript
import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';
import { useMyShares } from '../hooks/useMyShares';
import { useSharedWithMe } from '../hooks/useSharedWithMe';

export default function SharingPage() {
  const { shares: myShares, loading: mySharesLoading } = useMyShares();
  const { shares: sharedWithMe, loading: sharedWithMeLoading } = useSharedWithMe();
  const [email, setEmail] = useState('');
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSharing(true);
    setMessage(null);
    try {
      const shareEssays = httpsCallable(functions, 'shareEssays');
      await shareEssays({ email: email.trim() });
      setMessage({ type: 'success', text: `Shared with ${email.trim()}` });
      setEmail('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to share';
      setMessage({ type: 'error', text: msg });
    } finally {
      setSharing(false);
    }
  };

  const handleUnshare = async (recipientEmail: string) => {
    try {
      const unshareEssays = httpsCallable(functions, 'unshareEssays');
      await unshareEssays({ email: recipientEmail });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove share';
      setMessage({ type: 'error', text: msg });
    }
  };

  const handleRemoveSharedWithMe = async (ownerUid: string) => {
    try {
      const removeShared = httpsCallable(functions, 'removeSharedWithMe');
      await removeShared({ ownerUid });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove';
      setMessage({ type: 'error', text: msg });
    }
  };

  const loading = mySharesLoading || sharedWithMeLoading;
  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading...</p></div>;

  return (
    <div>
      <h2>Sharing</h2>

      {/* Share my essays */}
      <section style={{ marginBottom: 32 }}>
        <h3>Share My Essays</h3>
        <form onSubmit={handleShare} style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
          <input
            type="email"
            placeholder="Enter email address"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="input"
            style={{ flex: 1 }}
            disabled={sharing}
          />
          <button type="submit" className="btn-primary" disabled={sharing || !email.trim()}>
            {sharing ? 'Sharing...' : 'Share'}
          </button>
        </form>

        {message && (
          <div className={message.type === 'success' ? 'success-state' : 'error-state'} style={{ marginBottom: 16 }}>
            {message.text}
          </div>
        )}

        {myShares.length > 0 ? (
          <ul className="essay-list">
            {myShares.map((share) => (
              <li key={share.sharedWithUid} className="essay-list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{share.sharedWithEmail}</span>
                <button
                  onClick={() => handleUnshare(share.sharedWithEmail)}
                  className="btn-secondary"
                  style={{ fontSize: 13 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--color-text-secondary)' }}>You haven't shared your essays with anyone yet.</p>
        )}
      </section>

      {/* Shared with me */}
      <section>
        <h3>Shared With Me</h3>
        {sharedWithMe.length > 0 ? (
          <ul className="essay-list">
            {sharedWithMe.map((share) => (
              <li key={share.ownerUid} className="essay-list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{share.ownerEmail}</span>
                <button
                  onClick={() => handleRemoveSharedWithMe(share.ownerUid)}
                  className="btn-secondary"
                  style={{ fontSize: 13 }}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--color-text-secondary)' }}>No one has shared their essays with you.</p>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 2: Verify build (now that SharingPage exists, Task 19 + 20 together)**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit (covers Task 19 + 20)**

```
feat: add SharingPage and shared essay routes
```

---

### Task 21: Add Sharing link to Layout nav

**Files:**
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: Add Sharing nav link**

Add after the Progress NavLink (line 15):

```typescript
<NavLink to="/sharing">Sharing</NavLink>
```

- [ ] **Step 2: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 3: Commit**

```
feat: add Sharing link to navigation bar
```

---

### Task 22: Final build and manual smoke test

- [ ] **Step 1: Full frontend build**

Run: `cd /home/ssilver/development/essay-grader && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 2: Full functions build**

Run: `cd /home/ssilver/development/essay-grader/functions && npm run build`
Expected: Build succeeds with no errors

- [ ] **Step 3: Run frontend tests**

Run: `cd /home/ssilver/development/essay-grader && npm test`
Expected: All existing tests pass

- [ ] **Step 4: Run functions tests**

Run: `cd /home/ssilver/development/essay-grader/functions && npm test`
Expected: All existing tests pass

---

## Parallelism Guide

The following tasks can be executed in parallel:

**Wave 0 (dev infrastructure — no dependencies):**
- Task 0A (devSignIn cloud function) — standalone
- Task 0B (dev login buttons on LoginPage) — standalone (needs 0A deployed to work, but can be coded in parallel)

**Wave 1 (no dependencies, can overlap with Wave 0):**
- Task 1 (types) — standalone
- Task 2 (security rules) — standalone
- Task 3 (indexes) — standalone
- Task 4 (resolveEssayOwner) — standalone

**Wave 2 (depends on Task 4):**
- Task 5 (shareEssays) — standalone
- Task 6 (unshareEssays) — standalone
- Task 7 (removeSharedWithMe) — standalone
- Task 8 (resubmitDraft) — depends on Task 4
- Task 9 (analyzeTransitions) — depends on Task 4
- Task 10 (analyzeGrammar) — depends on Task 4
- Task 11 (deleteAccount) — standalone

**Wave 3 (frontend hooks):**
- Task 12 (useSharedWithMe) — standalone
- Task 13 (useMyShares) — standalone
- Task 15 (useEssay) — standalone

**Wave 4 (depends on Task 12):**
- Task 14 (useEssays) — depends on Task 12

**Wave 5 (depends on Tasks 14, 15):**
- Task 16 (HomePage) — depends on Task 14
- Task 17 (EssayPage) — depends on Task 15
- Task 18 (RevisionPage) — depends on Task 15
- Task 20 (SharingPage) — depends on Tasks 12, 13

**Wave 6 (depends on Wave 5):**
- Task 19 (routes) — depends on Task 20
- Task 21 (Layout nav) — standalone
- Task 22 (final verification) — depends on all
