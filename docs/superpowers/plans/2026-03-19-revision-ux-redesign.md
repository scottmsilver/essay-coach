# Revision UX Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminate the separate `/revise` page and fold revision mode into EssayPage as an inline toggle, with different UX for copy/paste vs Google Docs students.

**Architecture:** EssayPage gains a `revising` boolean state. When true, the DocBar shows Cancel/Resubmit, the score bar hides, an instruction banner appears, and the annotated essay is replaced by an editor (copy/paste) or stays read-only with a Docs link banner (Google Docs). All resubmit logic moves from RevisionPage into EssayPage. RevisionPage and its route are deleted, with redirects for old URLs.

**Tech Stack:** React, TypeScript, Mantine UI, Firebase Firestore, React Router

**Spec:** `docs/superpowers/specs/2026-03-19-revision-ux-redesign.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/pages/EssayPage.tsx` | MODIFY | Add `revising` state, revision mode UI, resubmit logic |
| `src/App.tsx` | MODIFY | Remove RevisionPage import/routes, add `/revise` → `/essay/:id` redirects |
| `src/index.css` | MODIFY | Add revision-mode CSS, remove unused revision-banner CSS |
| `src/pages/RevisionPage.tsx` | DELETE | No longer needed |
| `src/pages/RevisionPage.test.tsx` | DELETE | Tests for deleted page |
| `src/pages/EssayPage.test.tsx` | MODIFY | Update Revise button tests, add revision mode tests |

---

### Task 1: Add revision mode CSS

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add revision-mode styles to index.css**

Add after the existing `/* ═══ Skeleton essay placeholder ═══ */` section at the end of the file:

```css
/* ═══ Revision mode ═══ */
.revision-banner {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 24px;
  border-bottom: 1px solid var(--color-border);
  font-size: 13px;
}
.revision-banner-copypaste {
  background: rgba(5, 150, 105, 0.05);
  border-bottom-color: rgba(5, 150, 105, 0.15);
}
.revision-banner-gdoc {
  background: rgba(245, 158, 11, 0.05);
  border-bottom-color: rgba(245, 158, 11, 0.15);
}
.revision-banner-icon {
  font-size: 18px;
  flex-shrink: 0;
}
.revision-banner-text {
  flex: 1;
}
.revision-banner-text strong {
  display: block;
  color: var(--color-text);
  font-size: 13px;
}
.revision-banner-text span {
  color: var(--color-text-secondary);
  font-size: 12px;
}
.revision-editor-active {
  border: 2px solid var(--color-primary) !important;
}
```

- [ ] **Step 2: Remove unused old revision-banner CSS**

Delete the existing old `.revision-banner`, `.revision-banner h3`, `.revision-steps`, `.revision-step`, and `.revision-step.active` rules (around lines 669-679) — these are unused legacy styles with different definitions than the new `.revision-banner` added in Step 1. The old rules must be removed so only the new revision-banner definition remains.

- [ ] **Step 3: Verify build**

Run: `cd /home/ssilver/development/essay-grader && npm run build`
Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add src/index.css
git commit -m "style: add revision-mode CSS, remove unused revision-banner styles"
```

---

### Task 2: Update App.tsx routes — remove RevisionPage, add redirects

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Replace RevisionPage import with Navigate import**

Replace the `RevisionPage` import with `Navigate` from react-router-dom:

```typescript
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
```

Remove:
```typescript
import RevisionPage from './pages/RevisionPage';
```

- [ ] **Step 2: Replace /revise routes with redirects**

React Router v6 doesn't support param substitution in `<Navigate to>`, so add a small redirect component above the `App` function:

```typescript
function ReviseRedirect() {
  const { essayId, ownerUid } = useParams();
  const to = ownerUid ? `/user/${ownerUid}/essay/${essayId}` : `/essay/${essayId}`;
  return <Navigate to={to} replace />;
}
```

Update the react-router-dom import to include `Navigate` and `useParams`:
```typescript
import { BrowserRouter, Routes, Route, Navigate, useParams } from 'react-router-dom';
```

Replace the two RevisionPage routes (lines 26 and 31) with:
```typescript
<Route path="/essay/:essayId/revise" element={<ReviseRedirect />} />
```
and:
```typescript
<Route path="/user/:ownerUid/essay/:essayId/revise" element={<ReviseRedirect />} />
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. (RevisionPage.tsx still exists but is no longer imported — tree-shaken.)

- [ ] **Step 4: Commit**

```bash
git add src/App.tsx
git commit -m "refactor: replace /revise routes with redirects to /essay/:id"
```

---

### Task 3: Add revision mode to EssayPage

This is the main task. We add `revising` state, the revision mode UI, and all resubmit logic.

**Files:**
- Modify: `src/pages/EssayPage.tsx`

- [ ] **Step 1: Add imports for revision mode**

Add these imports at the top of EssayPage.tsx:

Check existing imports and add only the missing ones. The following are needed for revision mode:

```typescript
import { doc, collection, setDoc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { handleRichPaste } from '../utils/pasteHandler';
import { fetchGDocInfo } from '../utils/gdocImport';
import { parseSections } from '../../shared/gdocTypes';
import { TRAIT_KEYS } from '../types';
```

Also add `classifyAnnotation` to the existing `../utils` import line:
```typescript
import { scoreColor, relativeTime, collectAnnotations, classifyAnnotation } from '../utils';
```

Note: `fireAllAnalyses` from `'../utils/submitEssay'` is likely already imported. `doc` and `updateDoc` from `'firebase/firestore'` are already imported. Only add what's missing.

- [ ] **Step 2: Add revision state variables**

After the existing state declarations (around line 48), add:

```typescript
const [revising, setRevising] = useState(false);
const [revisionContent, setRevisionContent] = useState('');
const [resubmitting, setResubmitting] = useState(false);
const [resubmitError, setResubmitError] = useState<string | null>(null);
const [refetching, setRefetching] = useState(false);
const revisionInitialized = useRef(false);
```

- [ ] **Step 3: Add enterRevisionMode handler**

After the existing `handleFeedbackReanalyze` callback, add:

```typescript
const enterRevisionMode = useCallback(() => {
  if (!activeDraft) return;
  setRevising(true);
  setResubmitError(null);
  revisionInitialized.current = false;
  // Initialize content from localStorage or current draft
  const saved = localStorage.getItem(`essaycoach_autosave_${essayId}`);
  setRevisionContent(saved ?? activeDraft.content);
  // Auto-select highest-priority revision trait
  if (activeDraft.evaluation) {
    const prioritized = TRAIT_KEYS
      .filter((t) => activeDraft.evaluation!.traits[t].revisionPriority !== null)
      .sort((a, b) => (activeDraft.evaluation!.traits[a].revisionPriority! - activeDraft.evaluation!.traits[b].revisionPriority!));
    if (prioritized.length > 0) setActiveTrait(prioritized[0]);
  }
}, [activeDraft, essayId]);
```

- [ ] **Step 4: Add exitRevisionMode handler**

```typescript
const exitRevisionMode = useCallback(() => {
  setRevising(false);
  setResubmitError(null);
}, []);
```

- [ ] **Step 5: Add revisionContentChange handler (with autosave)**

```typescript
const handleRevisionContentChange = useCallback((newContent: string) => {
  setRevisionContent(newContent);
  localStorage.setItem(`essaycoach_autosave_${essayId}`, newContent);
}, [essayId]);
```

- [ ] **Step 6: Add handleResubmit handler**

This is the core resubmit logic, moved from RevisionPage:

```typescript
const handleResubmit = useCallback(async () => {
  if (!essayId || !user || !activeDraft || ownerUid) return;
  setResubmitting(true);
  setResubmitError(null);
  try {
    let essayContent = revisionContent;

    // Re-fetch from Google Docs if content is doc-sourced
    if (essay?.contentSource) {
      setRefetching(true);
      try {
        const data = await fetchGDocInfo(essay.contentSource.docId, essay.contentSource.tab);
        const sections = parseSections(data.text, data.bookmarks);
        if (essay.contentSource.sectionIndex < sections.length) {
          essayContent = sections[essay.contentSource.sectionIndex];
        }
      } catch (err) {
        console.warn('Failed to re-fetch from Google Docs, using current content:', err);
      }
      setRefetching(false);
    }

    const uid = user.uid;
    const newDraftNumber = (essay?.currentDraftNumber ?? activeDraft.draftNumber) + 1;
    const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
    const draftRef = doc(collection(db, `users/${uid}/essays/${essayId}/drafts`));

    await Promise.all([
      setDoc(draftRef, {
        draftNumber: newDraftNumber,
        content: essayContent,
        submittedAt: serverTimestamp(),
        grammarStatus: { stage: 'pending', message: 'Queued...' },
        transitionStatus: { stage: 'pending', message: 'Queued...' },
      }),
      updateDoc(essayRef, {
        currentDraftNumber: newDraftNumber,
        updatedAt: serverTimestamp(),
      }),
    ]);

    localStorage.removeItem(`essaycoach_autosave_${essayId}`);
    setRevising(false);
    setResubmitting(false);

    // Fire all 3 analyses in parallel (fire-and-forget)
    fireAllAnalyses(essayId, draftRef.id);
  } catch (err: unknown) {
    setResubmitError(err instanceof Error ? err.message : 'Failed to resubmit. Please try again.');
    setResubmitting(false);
  }
}, [essayId, user, activeDraft, ownerUid, essay, revisionContent]);
```

- [ ] **Step 7: Update DocBar — revision mode buttons**

Replace the existing DocBar `<Group>` children (the view selector, Analyze, Revise buttons). The new logic:

- When `revising`: show Cancel + Resubmit buttons, hide view selector and Analyze
- When not `revising`: show the existing view selector, Analyze, and Revise (unchanged)

Replace the `<Group gap="xs">` block inside DocBar's children with:

```tsx
<Group gap="xs">
  {revising ? (
    <>
      <Button size="compact-xs" variant="default" onClick={exitRevisionMode} disabled={resubmitting}>
        Cancel
      </Button>
      <Button
        size="compact-xs"
        onClick={handleResubmit}
        disabled={resubmitting}
        loading={resubmitting || refetching}
      >
        {essay?.contentSource
          ? (refetching ? 'Re-importing...' : 'Re-import & Evaluate')
          : 'Resubmit for Feedback'}
      </Button>
    </>
  ) : (
    <>
      <Select
        size="xs"
        value={activeView}
        onChange={(val) => {
          const view = val as 'feedback' | 'transitions' | 'grammar';
          if (view === 'transitions') handleTransitionsTab();
          else if (view === 'grammar') handleGrammarTab();
          else setActiveView('feedback');
        }}
        data={[
          { value: 'feedback', label: 'Overall' },
          { value: 'transitions', label: 'Transitions' },
          { value: 'grammar', label: 'Grammar' },
        ]}
        styles={{ input: { minWidth: 110 } }}
      />
      {evaluation && (
        <Button
          size="compact-xs"
          variant="default"
          onClick={
            activeView === 'grammar' ? handleGrammarReanalyze
            : activeView === 'transitions' ? handleTransitionReanalyze
            : handleFeedbackReanalyze
          }
          disabled={
            activeView === 'grammar' ? grammarLoading
            : activeView === 'transitions' ? transitionLoading
            : retrying || retryCount >= 3
          }
          loading={activeView === 'grammar' ? grammarLoading : activeView === 'transitions' ? transitionLoading : retrying}
        >
          Analyze
        </Button>
      )}
      {isLatestDraft && evaluation && !ownerUid && (
        <Button size="compact-xs" onClick={enterRevisionMode}>
          Revise
        </Button>
      )}
    </>
  )}
</Group>
```

Note: The Revise button changes from a `Link` (navigating to `/revise`) to a `Button` that calls `enterRevisionMode`. It now also checks `!ownerUid` (non-owners can't revise).

- [ ] **Step 8: Update DocBar draftLabel for revision mode**

Replace the `draftLabel` prop on the DocBar to show "· Revising" during revision mode instead of the version string:

```tsx
draftLabel={revising
  ? '· Revising'
  : `v${activeDraft.draftNumber} — ${relativeTime(activeDraft.submittedAt)}`
}
```

The `title` prop stays unchanged as `essay.title`.

- [ ] **Step 9: Add instruction banner + revision plan (below DocBar, above content)**

After the notification banner section and before the score bar, add the revision mode banner:

```tsx
{/* Revision mode instruction banner */}
{revising && (
  <>
    {essay?.contentSource ? (
      <div className="revision-banner revision-banner-gdoc">
        <span className="revision-banner-icon">📄</span>
        <div className="revision-banner-text">
          <strong>Edit your essay in Google Docs</strong>
          <span>Make your revisions there, then click Re-import & Evaluate to get new feedback.</span>
        </div>
        <Button
          component="a"
          href={`https://docs.google.com/document/d/${essay.contentSource.docId}/edit`}
          target="_blank"
          rel="noopener noreferrer"
          size="compact-xs"
          variant="light"
          color="yellow"
        >
          Open in Google Docs ↗
        </Button>
      </div>
    ) : (
      <div className="revision-banner revision-banner-copypaste">
        <span className="revision-banner-icon">✏️</span>
        <div className="revision-banner-text">
          <strong>Edit your essay below or paste your revised version</strong>
          <span>Feedback is shown on the right for reference.</span>
        </div>
      </div>
    )}
    {resubmitError && (
      <div className="error-state" style={{ margin: '0 24px' }}>{resubmitError}</div>
    )}
    {/* Compact revision plan */}
    {evaluation && evaluation.revisionPlan.length > 0 && (
      <div className="revision-plan-inline" style={{ margin: '8px 24px' }}>
        <strong>Focus on:</strong>
        <ol>
          {evaluation.revisionPlan.map((step, i) => <li key={i}>{step}</li>)}
        </ol>
      </div>
    )}
  </>
)}
```

- [ ] **Step 10: Hide score bar and feedback summary in revision mode**

Wrap the existing score bar section with `!revising &&`:

```tsx
{activeView === 'feedback' && !revising && (
  <div className="score-bar">
    {/* ... existing score bar content ... */}
  </div>
)}
```

Similarly for the feedback summary:
```tsx
{activeView === 'feedback' && evaluation && !revising && (
  <div className="feedback-summary">
    {/* ... existing content ... */}
  </div>
)}
```

- [ ] **Step 11: Add revision mode essay view (editor + sidebar)**

Replace the existing feedback view essay section. The current block:

```tsx
{activeView === 'feedback' && (
  evaluation ? (
    <AnnotatedEssay ... />
  ) : (
    <div className="skeleton-essay">...</div>
  )
)}
```

Becomes:

```tsx
{activeView === 'feedback' && (
  revising ? (
    <div className="revision-layout">
      <div className="revision-editor">
        {essay?.contentSource ? (
          <AnnotatedEssay
            content={activeDraft.content}
            annotations={allAnnotations}
            readOnly
            activeTrait={activeTrait}
          />
        ) : (
          <textarea
            className="essay-editor revision-editor-active"
            value={revisionContent}
            onChange={(e) => handleRevisionContentChange(e.target.value)}
            onPaste={(e) => handleRichPaste(e, handleRevisionContentChange)}
          />
        )}
      </div>
      <div className="revision-annotations">
        <div className="revision-annotations-header">Feedback</div>
        {(activeTrait
          ? allAnnotations.filter(a => a.traitKey === activeTrait)
          : allAnnotations
        ).map((ann, i) => (
          <div key={i} className={`sidebar-comment ${classifyAnnotation(ann.comment)}`} style={{ position: 'static' }}>
            <span className="sidebar-comment-trait">{ann.traitLabel}</span>
            <span className="sidebar-comment-text">{ann.comment}</span>
          </div>
        ))}
      </div>
    </div>
  ) : evaluation ? (
    <AnnotatedEssay
      content={activeDraft.content}
      annotations={allAnnotations}
      readOnly
      activeTrait={activeTrait}
    />
  ) : (
    <div className="skeleton-essay">
      <div className="skeleton-essay-text">{activeDraft.content}</div>
    </div>
  )
)}
```

Note: `classifyAnnotation` was added to the `../utils` import in Step 1.

- [ ] **Step 12: Hide transitions/grammar tabs in revision mode**

Wrap the transitions and grammar AnalysisPanel sections with `!revising &&`:

```tsx
{activeView === 'transitions' && !revising && (
  <AnalysisPanel ...>
    <TransitionView ... />
  </AnalysisPanel>
)}

{activeView === 'grammar' && !revising && (
  <AnalysisPanel ...>
    <GrammarView ... />
  </AnalysisPanel>
)}
```

- [ ] **Step 13: Verify build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 14: Manual smoke test**

Run the dev server and test:
1. Navigate to an evaluated essay
2. Click "Revise" — page should transform in-place
3. Verify instruction banner appears
4. Verify editor pre-fills with essay content
5. Verify feedback sidebar is visible
6. Click "Cancel" — returns to normal view
7. Click "Revise" again, click "Resubmit" — new draft created, skeleton UI appears

- [ ] **Step 15: Commit**

```bash
git add src/pages/EssayPage.tsx
git commit -m "feat: add inline revision mode to EssayPage"
```

---

### Task 4: Delete RevisionPage and its tests

**Files:**
- Delete: `src/pages/RevisionPage.tsx`
- Delete: `src/pages/RevisionPage.test.tsx`

- [ ] **Step 1: Delete RevisionPage.tsx**

```bash
rm src/pages/RevisionPage.tsx
```

- [ ] **Step 2: Delete RevisionPage.test.tsx**

```bash
rm src/pages/RevisionPage.test.tsx
```

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: Build succeeds. RevisionPage is no longer imported anywhere (App.tsx was updated in Task 2).

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All remaining tests pass. RevisionPage tests are gone. EssayPage tests may need updating (Task 5).

- [ ] **Step 5: Commit**

```bash
git add -u src/pages/RevisionPage.tsx src/pages/RevisionPage.test.tsx
git commit -m "refactor: delete RevisionPage — revision mode is now inline on EssayPage"
```

---

### Task 5: Update EssayPage tests

**Files:**
- Modify: `src/pages/EssayPage.test.tsx`

- [ ] **Step 1: Read current EssayPage tests**

Read `src/pages/EssayPage.test.tsx` to understand the existing test structure and mocking patterns.

- [ ] **Step 2: Update the Revise button test**

The existing test checks for a "Revise" link (which was a `<Link>` navigating to `/revise`). Now it's a `<Button>` that calls `enterRevisionMode`. Update the test to check for a "Revise" button instead of a link:

Find the test that checks for "Revise" and update its assertion from checking a link `href` to checking for a button with text "Revise".

- [ ] **Step 3: Add revision mode tests**

Add tests for the new behavior:

```typescript
it('enters revision mode when Revise is clicked', async () => {
  // Render with evaluated essay data
  // Click the Revise button
  // Assert: "Resubmit for Feedback" button appears
  // Assert: "Cancel" button appears
  // Assert: instruction banner appears ("Edit your essay below...")
  // Assert: revision plan is visible
});

it('exits revision mode when Cancel is clicked', async () => {
  // Enter revision mode
  // Click Cancel
  // Assert: score pills are visible again
  // Assert: "Revise" button is back
});
```

Match the existing test patterns (mock setup, render approach, assertion style) from the file.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 5: Commit**

```bash
git add src/pages/EssayPage.test.tsx
git commit -m "test: update EssayPage tests for inline revision mode"
```

---

### Task 6: Clean up unused CSS and verify

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Verify no remaining references to deleted revision-banner classes**

Grep the codebase for any remaining references to the old `.revision-banner`, `.revision-steps`, `.revision-step` classes. There should be none after RevisionPage is deleted.

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 3: Run full build**

Run: `npm run build`
Expected: Build succeeds.

- [ ] **Step 4: Final commit**

```bash
git commit --allow-empty -m "chore: revision UX redesign complete"
```

(Only if there are changes to commit from cleanup. Skip if nothing changed.)
