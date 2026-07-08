# Import Google Docs with Tracked Changes Accepted — Design

**Date:** 2026-07-07
**Status:** Approved (pending spec review)

## Problem

When a student's Google Doc contains suggested edits (track changes), the app
currently grades the *base* text only. The Apps Script web app reads the doc
via `DocumentApp`, which cannot see suggestions at all — suggested insertions
are silently ignored and suggested deletions remain. Students who work in
suggesting mode (or whose teachers leave suggestions) get feedback on a stale
version of their essay.

## Goal

Let the user import a Google Doc **as if all suggestions were accepted**, with
a toggle to choose the original (base) text instead. The Google Doc itself is
never modified.

## Decisions (made during brainstorming)

1. **Import the accepted projection; never mutate the doc.**
2. **Toggle, not always-on:** user picks Original vs Suggestions-accepted at
   import time.
3. **Approach B — single formatter:** replace `DocumentApp` with the Docs
   advanced service (Docs API) for *both* modes, one JSON→text builder. No
   dual formatters that must stay byte-identical.
4. **Default = "Suggestions accepted"** when the doc has suggestions; toggle
   hidden entirely when it has none.
5. **Mode is per-imported-field:** each `DocSource` (essay `contentSource`,
   `promptSource`, `criteriaSource`) carries its own mode.
6. **Before/after equivalence harness (required by user):** validate the new
   formatter against the old one using **all Google Docs referenced in the
   production Firestore DB** before cutting over.

## Architecture

Three layers, all reusing the existing pipeline
(Apps Script web app → `fetchGDocInfo` → `parseSections` → `DocSource`):

### 1. Apps Script (`functions/scripts/apps-script-source.ts`)

- Switch from `DocumentApp` body-walking to the **Docs advanced service**:
  `Docs.Documents.get(docId, { suggestionsViewMode })`.
  - `suggestions=base` → `PREVIEW_WITHOUT_SUGGESTIONS`
  - `suggestions=accepted` → `PREVIEW_SUGGESTIONS_ACCEPTED`
  - Param omitted → `base` (backward compatible with deployed clients).
- New response field `hasSuggestions: boolean`: the script makes one extra
  `Docs.Documents.get` in `DEFAULT_FOR_CURRENT_ACCESS` mode (which keeps
  suggestion markers) and scans the JSON for
  `suggestedInsertionIds`/`suggestedDeletionIds`. The preview-mode fetch used
  for `text` strips those markers, so it cannot detect suggestions itself.
  The client uses this to decide whether to show the toggle.
- **Single JSON→text builder** replicating the existing FORMAT CONTRACT
  (must stay in sync with `src/utils/pasteHandler.ts`):
  - Indented paragraphs → `\t` prefix
  - Bullet list items → `•` prefix
  - Numbered list items → `N.` prefix (per-list counters)
  - Paragraph separation → `\n\n`; consecutive list items → `\n`
- **Bookmark offsets** — CORRECTION (verified during planning): the Docs REST
  API does **not** expose bookmark positions, only links to bookmarks. So
  bookmarks remain sourced from `DocumentApp` (element + offset), and are
  mapped into the projected text via an element-index mapping computed from
  the `DEFAULT_FOR_CURRENT_ACCESS` JSON (which marks suggested insertions/
  deletions). Section splitting therefore works in both modes, with offsets
  clamped to the containing paragraph when suggestions shift content.
- Manifest: enable the Docs advanced service (`Docs` v1). Web app continues
  to run as the deploying account (`USER_DEPLOYING`) — **no new user auth**.
  OAuth scopes already include `documents`.

### 2. Shared types (`shared/gdocTypes.ts`)

```ts
export type SuggestionMode = 'base' | 'accepted';

export interface DocSource {
  docId: string;
  tab: string;
  sectionIndex: number;
  docName?: string;
  /** How the doc text was projected at import. undefined = 'base'
   *  (backward compatible with all existing essays). */
  suggestionMode?: SuggestionMode;
}

export interface GDocWebAppResponse {
  // ...existing fields...
  hasSuggestions: boolean;
}
```

`fetchGDocInfo(docId, tab?, suggestions?)` passes the mode as a query param.

### 3. Client UX (`src/components/GDocImportDialog.tsx`)

- On the **content** step, when `hasSuggestions` is true, show a Mantine
  `SegmentedControl`: **Original | Suggestions accepted**.
  - Default: **Suggestions accepted**.
  - Flipping re-fetches in that mode and re-runs `parseSections`.
  - Hidden when `hasSuggestions` is false → behavior identical to today.
- `makeSource(...)` bakes the chosen mode into the `DocSource`.
- `useGDocChangeDetection` re-reads using `source.suggestionMode`, so change
  detection compares the same projection the text was imported in (no false
  "doc changed" flapping between projections).

## Before/After Equivalence Harness (pre-cutover gate)

A one-off script, `functions/scripts/verify-gdoc-formatter.ts`, run before the
new Apps Script version becomes the production deployment:

1. **Corpus:** enumerate every essay in Firestore (collection group query over
   `users/*/essays/*`), collect all distinct `(docId, tab)` pairs from
   `contentSource`, `promptSource`, and `criteriaSource`.
2. **Dual deployment:** deploy the new Apps Script code as a *separate*
   deployment (Apps Script supports multiple versioned deployments of one
   script), keeping the current production deployment untouched.
3. **Fetch both:** for each `(docId, tab)`, fetch via the old deployment
   (`DocumentApp` formatter) and via the new deployment with
   `suggestions=base`.
4. **Compare:** `text` must be byte-identical; `bookmarks` (id + offset) must
   match exactly; `tabs` list must match. Any difference is a report entry
   with a unified diff.
5. **Report:** print per-doc PASS/FAIL and a summary. Docs that fail to fetch
   in the old path (deleted/permission-revoked) are recorded as SKIP, not
   FAIL.
6. **Gate:** cutover (repointing `VITE_GDOC_WEBAPP_DEPLOYMENT_ID` / updating
   the production deployment) happens only when the corpus passes 100%
   (excluding SKIPs), with any residual diffs explicitly reviewed and
   accepted.

Suggestion-mode correctness (accepted projection) is validated separately
with dedicated fixture docs (below), since existing DB docs may or may not
contain suggestions.

## Testing

- **Unit tests** for the JSON→text builder against saved Docs-API JSON
  fixtures: plain paragraphs, first-line indent, bullet lists, numbered lists
  (incl. restarting counters and multiple lists), bookmarks, empty
  paragraphs.
- **Suggestion fixtures:** a test doc containing suggested insertions,
  deletions, and replacements; assert `base` output omits insertions/keeps
  deletions and `accepted` output includes insertions/omits deletions; assert
  `hasSuggestions` flips appropriately.
- **Corpus harness** (above) as the final regression gate for base mode.
- Existing `parseSections` unit tests continue to cover section splitting.

## Error handling

- Docs advanced service disabled / API error → `{ error }` response, surfaced
  in the dialog exactly like current errors.
- Docs the deploying account can't read behave as today (error at fetch).
- Re-fetch on toggle-flip shows the dialog's existing loading state; a
  failure keeps the previous projection and shows the error.

## Out of scope

- Mutating the Google Doc (accepting suggestions for real).
- Showing a diff/annotation of what the suggestions changed.
- Per-suggestion selective acceptance.
- Comment (non-suggestion) handling — unchanged.

## Rollout

1. Land builder + tests; deploy new Apps Script as secondary deployment.
2. Run equivalence harness over full DB corpus; fix regressions until clean.
3. Promote new script to the production deployment; land client toggle.
4. Existing essays keep `suggestionMode: undefined` → base; nothing re-reads
   differently until a user re-imports.
