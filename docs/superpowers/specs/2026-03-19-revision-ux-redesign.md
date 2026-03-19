# Revision UX Redesign — Inline Revision Mode on EssayPage

## Problem

The current revision flow sends students to a separate `/revise` page that tries to be an editor AND a feedback viewer simultaneously. The result is cluttered and confusing:

- The "Resubmit" button is crammed into the top-left, disconnected from the editing area
- Score pills take up prime real estate but are read-only reference — not actionable
- Trait feedback, revision plan, editor, and annotation sidebar all stack vertically with no clear flow
- Google Docs students see a grey message saying "go edit in Docs, then come back" — no link, no guidance
- Copy/paste students get a raw textarea next to feedback, but the relationship between "read feedback → make changes → resubmit" isn't guided

The page is ugly, overwhelming, and the workflow is unclear for both student types.

## Solution

Eliminate the `/revise` route entirely. EssayPage gains an inline "revision mode" toggle. Students read feedback on EssayPage (where they already are), click "Revise" to enter revision mode in-place, make their changes, and resubmit — all without leaving the page.

## Design

### Normal Mode (unchanged)

The EssayPage works exactly as it does today:
- DocBar with title, draft picker, view selector (Overall/Transitions/Grammar), Analyze button, **Revise** button
- Score pill bar with trait scores
- Feedback summary (overall feedback, revision plan, improvements/remaining issues)
- Annotated essay with sidebar comments

### Revision Mode — Triggered by clicking "Revise"

When the student clicks "Revise", the page transforms in-place:

#### DocBar changes
- Title gets a "· Revising" label in primary color
- "Revise" button is replaced by:
  - **Cancel** button (outlined) — exits revision mode, returns to normal view
  - **Resubmit for Feedback** button (primary, copy/paste) or **Re-import & Evaluate** button (primary, Google Docs)
- View selector and Analyze button are hidden during revision mode

#### Instruction banner (below DocBar)
- **Copy/paste students:** "Edit your essay below or paste your revised version. Feedback is shown on the right for reference."
- **Google Docs students:** "Edit your essay in Google Docs" with description "Make your revisions there, then click Re-import & Evaluate to get new feedback." Includes an "Open in Google Docs ↗" link button that opens the doc in a new tab.

#### Revision plan (compact)
- Shown below the instruction banner
- Same content as current revision plan, styled compactly with the blue left-border accent

#### Two-column layout
- **Left column:**
  - Copy/paste: textarea pre-filled with current draft content, editable. Blue border indicates active editing. Autosaves to localStorage. Uses `handleRichPaste` to strip formatting on paste (same as current RevisionPage).
  - Google Docs: the annotated essay (read-only, with inline highlights), so the student can reference feedback while editing in their doc in another tab.
- **Right column:**
  - Feedback sidebar with all annotation comments (same as current EssayPage sidebar). Filterable by selected trait if a score pill was clicked before entering revision mode.

#### Score pills
- Hidden during revision mode to reduce visual noise. The scores are reference info that doesn't change during editing.

### Exiting Revision Mode

- **Cancel:** returns to normal EssayPage view. If copy/paste, any edits are preserved in localStorage (autosave).
- **Resubmit / Re-import:** creates a new draft, fires all 3 analyses in parallel (using `fireAllAnalyses()`), and the page shows the skeleton UI for the new draft while evaluation runs. The `revising` state resets to false.

### Copy/paste resubmit behavior

When a copy/paste student clicks "Resubmit for Feedback":
1. Take the textarea content as `essayContent`
2. Create a new draft doc in Firestore: `{ draftNumber, content: essayContent, submittedAt, grammarStatus: { stage: 'pending' }, transitionStatus: { stage: 'pending' } }`
3. Update the essay doc: `{ currentDraftNumber, updatedAt }`
4. Clear localStorage autosave
5. Reset `revising` to false
6. Fire `fireAllAnalyses()` — page shows skeleton UI for the new draft

Same Firestore write pattern as current RevisionPage `handleResubmit`.

### Google Docs re-import behavior

When a Google Docs student clicks "Re-import & Evaluate":
1. The latest content is fetched from their linked Google Doc (same `fetchGDocInfo` + `parseSections` logic as current RevisionPage)
2. A new draft is created with the fetched content
3. All 3 analyses fire in parallel
4. The page shows skeleton UI while evaluation runs

If the re-fetch fails, fall back to the stored content with a warning toast.

## What Changes

| File | Action | What |
|------|--------|------|
| `src/pages/RevisionPage.tsx` | DELETE | Entire file removed |
| `src/pages/RevisionPage.test.tsx` | DELETE | Tests for deleted page |
| `src/App.tsx` (or router config) | MODIFY | Remove `/revise` routes, add redirects from old URLs to `/essay/:id` |
| `src/pages/EssayPage.tsx` | MODIFY | Add `revising` state, revision mode UI, resubmit logic (moved from RevisionPage) |
| `src/pages/EssayPage.test.tsx` | MODIFY | Update tests: "Revise" link no longer navigates to `/revise`, revision mode tests |
| `src/index.css` | MODIFY | Add revision-mode styles (instruction banner, editing state) |

## What Stays the Same

- `fireAllAnalyses()` — already exists, reused for resubmit
- `useEssay()` hook — no changes
- Skeleton UI + progressive fill — already works from previous implementation
- localStorage autosave pattern — same logic, moved into EssayPage
- Google Docs re-fetch logic — same code, moved into EssayPage

## States

```
EssayPage
  ├── loading → spinner
  ├── essay not found → error
  ├── normal mode (revising = false)
  │   ├── evaluation pending → skeleton UI
  │   ├── evaluation error → error + retry
  │   └── evaluation complete → full feedback view
  └── revision mode (revising = true)
      ├── copy/paste → textarea + feedback sidebar
      └── google docs → annotated essay (read-only) + docs banner + feedback sidebar
```

## Edge Cases

- **Student navigates to old `/revise` URL:** redirect to `/essay/:id` (the revision action is now on EssayPage)
- **Shared essays (ownerUid):** "Revise" button is hidden for non-owners (same as current behavior)
- **No evaluation yet:** "Revise" button is hidden when evaluation is pending (can't revise what hasn't been evaluated)
- **Multiple drafts:** "Revise" button only appears for the latest draft (same `isLatestDraft` guard as current). Viewing older drafts shows feedback only — no revision action.
- **Autosave conflicts:** if student enters revision mode, edits, cancels, then re-enters — localStorage draft is restored (same as current RevisionPage behavior)
- **Trait auto-selection:** when entering revision mode, auto-select the highest-priority revision trait (same as current RevisionPage behavior) to pre-filter the feedback sidebar to the most actionable comments
