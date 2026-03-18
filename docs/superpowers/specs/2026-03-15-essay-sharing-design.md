# Essay Sharing Feature Design

## Overview

Allow a user to share their entire essay collection with another user, granting full read/write access. Sharing is one-way (A shares with B; B must separately share back for mutual access) and all-or-nothing (all essays, not per-essay). Shared essays appear mixed into the recipient's "My Essays" list with a badge indicating the owner.

## Data Model

### New collection: `shares/{shareId}`

```typescript
interface Share {
  id: string;
  ownerUid: string;
  ownerEmail: string;
  sharedWithUid: string;
  sharedWithEmail: string;
  createdAt: Date;
}
```

- **Document ID convention:** `{ownerUid}_{sharedWithUid}` (deterministic, enables `exists()` checks in security rules without querying)
- One document per sharing relationship
- No changes to existing `Essay`, `Draft`, or `UserProfile` types

### New frontend type

```typescript
interface EssayListItem extends Essay {
  ownerUid: string;
  ownerEmail: string;
}
```

Used by the merged essay list to tag each essay with its owner. The `Share` interface should also be added to `types.ts`.

### Queries

- "Who shared with me?": `shares` where `sharedWithUid == myUid`
- "Who have I shared with?": `shares` where `ownerUid == myUid`
- Uniqueness enforced by deterministic doc ID (overwrites are prevented in cloud function)

### Known limitation

You cannot share with a user who has never logged in. The `shareEssays` function looks up recipients by email in the `users` collection, which is only populated on first login.

## Firestore Security Rules

### Helper function

```
function isSharedWith(uid) {
  return exists(/databases/$(database)/documents/shares/$(uid + '_' + request.auth.uid));
}
```

Share document integrity is guaranteed by the cloud-function-only write restriction. The `isSharedWith()` helper intentionally checks only document existence (not field values) to minimize Firestore read costs.

### Updated essay/draft rules

All existing `request.auth.uid == uid` checks become `request.auth.uid == uid || isSharedWith(uid)`:

- `users/{uid}/essays/{essayId}` — read, write: add `|| isSharedWith(uid)`
- `users/{uid}/essays/{essayId}/drafts/{draftId}` — read, create, update: add `|| isSharedWith(uid)`
- Draft create/update restrictions (no client-side evaluation writes) remain unchanged
- Shared users are subject to the same client-side write restrictions as the owner — they cannot write evaluation data directly; only cloud functions can write evaluations

### `users/{uid}` parent document rule — intentionally unchanged

The `users/{uid}` document rule stays as `request.auth.uid == uid`. Shared users access essays/drafts via direct subcollection paths, which do not require parent document read access in Firestore. Shared users should NOT be able to read or modify the owner's profile document.

### Shares collection rules

```
match /shares/{shareId} {
  allow read: if request.auth != null
    && (resource.data.ownerUid == request.auth.uid
        || resource.data.sharedWithUid == request.auth.uid);
  allow create, update, delete: if false; // cloud function only
}
```

All client queries on the `shares` collection must include a filter matching the caller's UID on either `ownerUid` or `sharedWithUid`, since Firestore `list` operations require that query constraints guarantee the rule passes for every returned document.

### Cost note

Each access check on a shared essay costs one additional Firestore read (the `exists()` call). This is acceptable for the expected usage scale.

## Cloud Functions

### New: `shareEssays` (HTTP callable)

**Input:** `{ email: string }`

**Flow:**
1. Validate input: email is a non-empty string
2. Check caller is allowlisted
3. Query `users` collection where `email == input.email` to find recipient
4. Error if recipient not found: "User not found or not on allowlist"
5. Error if recipient is caller: "Cannot share with yourself"
6. Check if `shares/{callerUid}_{recipientUid}` already exists
7. Error if already shared: "Already shared with this user"
8. Create share doc at `shares/{callerUid}_{recipientUid}` with `ownerUid`, `ownerEmail`, `sharedWithUid`, `sharedWithEmail`, `createdAt`

### New: `unshareEssays` (HTTP callable)

**Input:** `{ email: string }`

**Flow:**
1. Validate input: email is a non-empty string
2. Query `users` collection where `email == input.email` to find recipient UID
3. Delete `shares/{callerUid}_{recipientUid}`
4. Error if doc doesn't exist: "No active share with this user"

### New: `removeSharedWithMe` (HTTP callable)

Allows a recipient to remove an unwanted share (the "I don't want to see this person's essays" case).

**Input:** `{ ownerUid: string }`

**Flow:**
1. Delete `shares/{ownerUid}_{callerUid}`
2. Error if doc doesn't exist: "No active share from this user"

### Modified: `resubmitDraft`, `analyzeTransitions`, `analyzeGrammar`

**Change:** Accept optional `ownerUid` parameter.

- If `ownerUid` is omitted or equals caller UID: operate on `users/{callerUid}/essays/...` (existing behavior)
- If `ownerUid` differs from caller: verify `shares/{ownerUid}_{callerUid}` exists, then operate on `users/{ownerUid}/essays/...`
- Error if share doc not found: "You do not have access to this user's essays"

**Parameter signatures after modification:**
- `resubmitDraft`: `{ essayId: string, content: string, ownerUid?: string }`
- `analyzeTransitions`: `{ essayId: string, draftId: string, ownerUid?: string }`
- `analyzeGrammar`: `{ essayId: string, draftId: string, ownerUid?: string }`

**Implementation note:** Extract a shared helper `resolveEssayOwner(callerUid: string, ownerUid?: string): Promise<string>` that verifies share access and returns the resolved owner UID. Used by all three functions to avoid duplicating the share-check logic.

### NOT modified: `submitEssay`

`submitEssay` does NOT accept an `ownerUid` parameter. New essay creation always happens in the caller's own account. Sharing grants access to existing essays and their drafts, not the ability to create new essays in someone else's namespace.

### Modified: `deleteAccount`

Add share cleanup. When a user is deleted:
1. Query `shares` where `ownerUid == deletedUid` — delete all (essays are gone, shares are stale)
2. Query `shares` where `sharedWithUid == deletedUid` — delete all (recipient no longer exists)

## Frontend

### New hooks

**`useSharedWithMe()`**
- Real-time query: `shares` where `sharedWithUid == myUid`
- Returns: `{ shares: Array<{ ownerUid: string, ownerEmail: string }>, loading: boolean }`

**`useMyShares()`**
- Real-time query: `shares` where `ownerUid == myUid`
- Returns: `{ shares: Array<{ sharedWithUid: string, sharedWithEmail: string }>, loading: boolean }`

### Modified hooks

**`useEssays()`**
- After fetching own essays, also fetch essays for each `ownerUid` from `useSharedWithMe()`
- Each essay tagged with `ownerUid` and `ownerEmail` (own essays tagged with self)
- All essays merged and sorted by `updatedAt` desc
- Returns `EssayListItem[]` instead of `Essay[]`

**Listener lifecycle management:** When the shares list changes, diff against current listeners and only add/remove the changed ones. Each sharer's essay listener is tracked independently. The combined `loading` state is true until all listeners have resolved at least once. If one sharer's query fails, it should not block the rest — log the error and omit that sharer's essays.

**`useEssay(essayId, ownerUid?)`**
- If `ownerUid` provided: read from `users/{ownerUid}/essays/{essayId}/drafts/...`
- Otherwise: read from own path (existing behavior)

### Routing

**New routes:**
- `/user/:ownerUid/essay/:essayId` — view a shared essay
- `/user/:ownerUid/essay/:essayId/revise` — revise a shared essay
- `/sharing` — sharing management page

**Existing routes unchanged:** `/essay/:essayId` continues to work for own essays (ownerUid defaults to self).

### UI changes

**HomePage:**
- Shared essays appear in the same list as own essays
- Badge on shared essays: "Shared by {ownerEmail}"
- Links to `/user/{ownerUid}/essay/{essayId}` for shared essays

**NewEssayPage:**
- No changes. New essays are always created in the current user's own account, regardless of sharing.

**EssayPage / RevisionPage:**
- Read `ownerUid` from URL params
- Pass `ownerUid` to `useEssay` hook
- Pass `ownerUid` to cloud function calls (`resubmitDraft`, `analyzeTransitions`, `analyzeGrammar`)

**ProgressPage:**
- No changes for v1. Shows only the current user's own essay progress. Shared essay progress is out of scope.

**New: SharingPage (`/sharing`):**
- "Share my essays" section: email input + "Share" button → calls `shareEssays`. List of current outgoing shares with "Remove" button → calls `unshareEssays`
- "Shared with me" section: list of incoming shares with "Remove" button → calls `removeSharedWithMe`
- Accessible from nav bar (new "Sharing" link in Layout component)

### Firestore indexes

New composite indexes needed:
- `shares`: `sharedWithUid` ASC, `createdAt` DESC
- `shares`: `ownerUid` ASC, `createdAt` DESC

## Future extensibility

- **Per-essay sharing:** Add optional `essayId` field to `Share`. Null means "all essays." Security rules check for either an all-essays share or an essay-specific share.
- **Read-only sharing:** Add `permission: 'read' | 'readwrite'` field to `Share`. Security rules branch on the value.
- **Mutual sharing:** Frontend convenience that creates two share docs.
