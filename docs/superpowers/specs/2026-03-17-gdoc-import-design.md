# Google Docs Import Design

## Goal

Allow students to import essay text and assignment prompts from Google Docs, selecting a specific tab and section (defined by bookmarks). The Google Doc remains the source of truth — text is re-fetched on each analysis or resubmission.

## Architecture

The feature uses an already-deployed Apps Script web app that reads Google Docs on behalf of the deployer's account. No backend (Cloud Functions) changes are needed for fetching — the client calls the web app directly. The backend changes are limited to storing doc references and resolving them to text at evaluation time.

```
Client (React)
  │
  ├─ Import flow: calls Apps Script web app → gets tabs, sections, text
  │                                           (public endpoint, no auth needed)
  │
  ├─ Stores doc reference in Firestore (docId, tab, sectionIndex)
  │
  └─ Submit/Resubmit: calls Cloud Function
        │
        └─ Cloud Function resolves doc reference → fetches fresh text → evaluates
```

### Apps Script Web App (already deployed)

- **Endpoint**: `https://script.google.com/macros/s/{DEPLOYMENT_ID}/exec`
- **Parameters**: `?docId=<id>&tab=<tabName>`
- **Returns**: `{ tabTitle, tabId, textLength, text, bookmarks: [{id, offset}], tabs: [{title, id}] }`
- **Access**: `ANYONE_ANONYMOUS`, executes as deployer's Google account
- **Deployment ID**: stored in `functions/scripts/gdocs-script-id.json` (gitignored)

## Data Model Changes

### New type: `DocSource`

```typescript
interface DocSource {
  docId: string;        // Google Doc ID
  tab: string;          // Tab title
  sectionIndex: number; // Which section (0-based, divided by bookmarks)
}
```

### Essay document changes

Add optional fields to the Essay type:

```typescript
interface Essay {
  // ... existing fields ...

  // Source references (null = pasted text, present = Google Doc)
  promptSource?: DocSource | null;
  contentSource?: DocSource | null;
}
```

When `contentSource` is set, the essay text is fetched from the Google Doc at evaluation time. When null, `content` on the Draft is used as-is (pasted text).

When `promptSource` is set, the prompt text is fetched from the Google Doc at evaluation time. When null, `assignmentPrompt` on the Essay is used as-is.

### Draft document

No structural changes. The `content` field still stores the essay text — but now it may be populated by fetching from a Google Doc rather than from user paste. This means existing evaluation code works unchanged.

## UX Flow

### Import Dialog (used for both prompt and essay)

**Step 1: Paste URL**
- Text input for Google Docs URL
- Parse doc ID from URL
- Call web app with just `docId` (no tab) to get tab list
- Show loading spinner during fetch

**Step 2: Pick Tab**
- Show list of tab titles returned from web app
- User selects one
- Call web app again with `docId` + selected `tab`
- Get back text + bookmarks

**Step 3: Pick Section**
- Bookmarks divide the tab text into sections:
  - 0 bookmarks → 1 section (entire tab)
  - N bookmarks → N+1 sections
- Each section shows a preview (first ~150 chars, truncated)
- User selects which section to import
- Preview shows the selected section's full text

**Step 4: Confirm**
- Dialog closes
- The field (prompt or essay) shows the selected text as preview
- The `DocSource` reference is saved

### Integration with NewEssayPage

The existing form gets "Import from Google Docs" buttons next to both:
- **Assignment Prompt** textarea — imports prompt from a doc section
- **Essay Content** textarea — imports essay from a doc section

When a Google Doc source is set:
- The textarea shows a read-only preview of the imported text
- A "Change" link allows re-opening the import dialog
- A "Clear" link removes the doc source and returns to paste mode
- The text is NOT editable in the form (it lives in Google Docs)

### Integration with RevisionPage

When an essay has `contentSource`:
- The revision page does NOT show an editable textarea
- Instead it shows: "Your essay will be re-imported from Google Docs when you resubmit"
- The student edits in Google Docs, then clicks "Resubmit" in the grader
- The resubmit flow re-fetches the latest text from the doc

When an essay has no `contentSource` (pasted):
- Current behavior unchanged — editable textarea

## Backend Changes

### Text Resolution

Add a utility function that resolves a `DocSource` to text:

```typescript
async function resolveDocSource(source: DocSource): Promise<string> {
  // Call Apps Script web app
  // Parse sections from bookmarks
  // Return text for the specified section
}
```

### submitEssay changes

When `contentSource` is provided:
1. Call `resolveDocSource(contentSource)` to get essay text
2. Store the resolved text in the Draft's `content` field (for reference/display)
3. Store `contentSource` on the Essay document

When `promptSource` is provided:
1. Call `resolveDocSource(promptSource)` to get prompt text
2. Store the resolved text in Essay's `assignmentPrompt` field
3. Store `promptSource` on the Essay document

### resubmitDraft changes

When the Essay has `contentSource`:
1. Re-fetch text via `resolveDocSource(essay.contentSource)`
2. Use the fresh text as the new draft's `content`
3. No `content` field needed in the request body

When the Essay has `promptSource`:
1. Re-fetch prompt text via `resolveDocSource(essay.promptSource)`
2. Use fresh prompt for evaluation (the prompt could have been updated too)

When neither source is set: current behavior unchanged.

## Section Extraction Logic

Given text and bookmarks sorted by offset:

```
0 bookmarks: sections = [entireText]
1 bookmark:  sections = [text[0..bm1], text[bm1..end]]
2 bookmarks: sections = [text[0..bm1], text[bm1..bm2], text[bm2..end]]
N bookmarks: sections = [text[0..bm1], text[bm1..bm2], ..., text[bmN..end]]
```

Each section is trimmed of leading/trailing whitespace. Empty sections (e.g., two adjacent bookmarks) are included but shown as "(empty)" in the UI.

## Configuration

The Apps Script web app deployment ID must be available to:
- **Client** (React): via environment variable `VITE_GDOC_WEBAPP_ID` or similar
- **Backend** (Cloud Functions): via environment variable or Firebase config

The deployment ID is NOT hardcoded in source. It comes from environment config.

## Limitations & Future Work

- **Access**: The web app runs as the deployer's account. Only docs accessible to that account can be imported. For classroom use, students share their doc with the teacher.
- **No real-time sync**: Text is fetched on submit/resubmit, not continuously synced.
- **Bookmark stability**: If a student moves/deletes bookmarks between submissions, section indices may shift. The system fetches whatever is at the stored section index at fetch time.
- **Future**: Could add student OAuth so each student's own docs are accessible without sharing.

## Files to Create/Modify

### New files
- `src/components/GDocImportDialog.tsx` — Import dialog component
- `src/utils/gdocImport.ts` — Client-side doc fetching + section parsing
- `functions/src/gdocResolver.ts` — Server-side doc source resolution

### Modified files
- `src/types.ts` — Add `DocSource` type, extend `Essay`
- `src/pages/NewEssayPage.tsx` — Add import buttons for prompt and essay
- `src/pages/RevisionPage.tsx` — Handle doc-sourced essays (no textarea)
- `functions/src/submitEssay.ts` — Resolve doc sources before evaluation
- `functions/src/resubmitDraft.ts` — Re-fetch from doc sources on resubmit
- `functions/src/validation.ts` — Allow empty content/prompt when doc source provided
