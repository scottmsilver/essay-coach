# Essay Settings — Gear Icon Modal + Full Edit Page

Two entry points for editing essay metadata after submission: a quick-access gear icon modal and a full-page edit route.

## Entry Points

### 1. Gear icon in the essay header

A small gear icon next to the essay title in `AppHeader`'s `EssayHeader` mode. Clicking it opens `EssaySettingsModal`. Visible to both the essay owner and shared viewers.

### 2. Full edit page (`/essay/:id/edit`)

A full-page form pre-filled with existing essay data. Same `ContentInput` pattern as NewEssayPage. Accessible via:
- A "Full editor" link inside the settings modal
- Direct URL navigation

Both the essay owner and shared viewers can access this page.

## Editable Fields

All fields use the `ContentInput` component (collapsed zone with "Type or paste" / "Import from Docs"):

- **Title** — TextInput (not ContentInput, just a regular input)
- **Writing Type** — Select dropdown
- **Assignment Prompt** — ContentInput with GDoc import
- **Teacher Criteria** — ContentInput with GDoc import (optional)

## Save Behavior

Writes updated fields to the essay Firestore doc. Additionally, clears stale analysis on the current draft when fields that affect analysis change:

| Field changed | Clears on current draft |
|--------------|------------------------|
| Writing type | `evaluation`, `evaluationStatus` (6+1 depends on writing type) |
| Assignment prompt | `promptAnalysis`, `promptStatus` |
| Teacher criteria | `criteriaAnalysis`, `criteriaStatus`, `criteriaSnapshot` |
| Title | Nothing (no analysis depends on title) |

After save, a notification: "Essay settings updated". Navigating to a report tab that was cleared will lazy-trigger re-analysis.

## Routes

Add to `App.tsx`:
- `/essay/:essayId/edit`
- `/user/:ownerUid/essay/:essayId/edit`

Both render `EditEssayPage`.

## Components

### `EssaySettingsModal`

Props: `opened`, `onClose`, essay data fields, `onSave` callback.

Contents:
- Writing Type select (compact, same as NewEssayPage)
- Title input
- Assignment Prompt (ContentInput)
- Teacher Criteria (ContentInput, optional)
- "Open full editor" link at bottom (navigates to `/essay/:id/edit`)
- Save / Cancel buttons

### `EditEssayPage`

A new page component, similar to NewEssayPage but:
- Pre-fills all fields from the existing essay Firestore doc
- Uses `useEssay` hook to load essay data
- Back button/link returns to `/essay/:id/overall`
- Submit button says "Save Changes" instead of "Submit for Feedback"
- On save: writes to essay doc, clears affected analyses, navigates back to essay view

Uses the same `ContentInput` component, `GDocImportDialog`, and form layout as NewEssayPage.

### AppHeader change

Add a gear icon button to `EssayHeader` (the essay-page header variant). Clicking it opens `EssaySettingsModal`. Requires passing essay data and a save handler down through the header context.

Extend `EssayHeaderContext` with:
```typescript
onOpenSettings?: () => void;
```

The gear icon renders only when `onOpenSettings` is provided.

## Permissions

Both essay owner and shared viewers can edit settings. The `onSave` handler in EssayPage resolves the correct Firestore path using `ownerUid` (same pattern as `handleSaveCriteria`).

## Scope Boundaries

**In scope:**
- Gear icon in header opening settings modal
- `/essay/:id/edit` full edit page
- Clearing stale analyses on field changes
- ContentInput reuse for all text fields

**Out of scope:**
- Editing essay content from the settings modal/page (content editing stays in the Essay view)
- Changing the essay's owner
- Deleting an essay from the edit page
