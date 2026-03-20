# Unified Header & Layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unify the header across home and essay views into a consistent Google Docs-inspired shell. Bury Progress/Sharing behind avatar. Add warm gray background to essay pages. Center essay content in a max-width container.

**Architecture:** Replace the current split (AppShell header hidden on essay routes + separate DocBar) with a single header component that morphs by context. Home gets a single-row header (brand + new + avatar). Essay gets a connected two-row header (title row + toolbar row, avatar spanning both). Layout.tsx always shows the header — it just passes different props based on route context. DocBar is deleted.

**Tech Stack:** React, TypeScript, Mantine AppShell, React Router

**Spec:** `docs/superpowers/specs/2026-03-19-unified-header-layout.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/components/AppHeader.tsx` | CREATE | New unified header component — renders single-row (home) or two-row (essay) based on props |
| `src/components/Layout.tsx` | MODIFY | Always show header, pass route context to AppHeader, remove nav tabs, remove mobile drawer |
| `src/components/UserAvatarMenu.tsx` | MODIFY | Add email, Progress, Sharing links to dropdown |
| `src/pages/EssayPage.tsx` | MODIFY | Remove DocBar usage, pass header props up via context or render props |
| `src/components/DocBar.tsx` | DELETE | Functionality merged into AppHeader |
| `src/index.css` | MODIFY | Remove full-bleed override, add essay content max-width, new header styles, remove old nav-tab/doc-bar styles |
| `src/theme.ts` | MODIFY | Update AppShell header height |
| `src/constants.ts` | MODIFY | Remove NAV_LINKS (no longer used) or repurpose for avatar menu |
| `src/components/Layout.test.tsx` | MODIFY | Update tests for new header behavior |
| `src/pages/EssayPage.test.tsx` | MODIFY | Update DocBar references |

---

### Task 1: Create AppHeader component

**Files:**
- Create: `src/components/AppHeader.tsx`

This is the core new component. It renders differently based on whether essay context is provided.

- [ ] **Step 1: Create AppHeader with home mode**

```typescript
import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Group, Button } from '@mantine/core';
import UserAvatarMenu from './UserAvatarMenu';

interface DraftOption {
  id: string;
  label: string;
}

interface EssayContext {
  title: string;
  draftLabel: string;
  activeDraftId?: string;
  draftOptions?: DraftOption[];
  onPickDraft?: (id: string) => void;
  toolbar?: ReactNode;
}

interface Props {
  essayContext?: EssayContext;
}

export default function AppHeader({ essayContext }: Props) {
  if (essayContext) {
    return <EssayHeader {...essayContext} />;
  }

  return (
    <div className="app-header app-header-home">
      <Link to="/" className="app-header-brand">EssayCoach</Link>
      <div className="app-header-right">
        <Button component={Link} to="/new" size="compact-sm">
          + New Essay
        </Button>
        <UserAvatarMenu />
      </div>
    </div>
  );
}

function EssayHeader({ title, draftLabel, activeDraftId, draftOptions, onPickDraft, toolbar }: EssayContext) {
  // Draft picker state will be added in a later step
  return (
    <div className="app-header app-header-essay">
      <div className="app-header-essay-rows">
        {/* Row 1: Brand + title */}
        <div className="app-header-row1">
          <Link to="/" className="app-header-brand">EssayCoach</Link>
          <span className="app-header-sep">›</span>
          <span className="app-header-title">{title}</span>
          <span className="app-header-draft-label">{draftLabel}</span>
        </div>
        {/* Row 2: Toolbar */}
        <div className="app-header-row2">
          {toolbar}
        </div>
      </div>
      <div className="app-header-avatar-col">
        <UserAvatarMenu />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "feat: create AppHeader component with home and essay modes"
```

---

### Task 2: Add AppHeader CSS and update layout styles

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Add AppHeader styles**

Add after the existing header styles section:

```css
/* ═══ Unified App Header ═══ */
.app-header {
  background: var(--color-surface);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.06);
  border-bottom: 1px solid var(--color-border);
  display: flex;
  align-items: center;
  padding: 0 20px;
}
.app-header-home {
  height: 52px;
  justify-content: space-between;
}
.app-header-brand {
  color: var(--color-primary);
  font-family: var(--font-display);
  font-size: 20px;
  text-decoration: none;
  font-weight: 400;
  flex-shrink: 0;
}
.app-header-right {
  display: flex;
  gap: 8px;
  align-items: center;
}
.app-header-essay {
  display: flex;
  padding: 0;
}
.app-header-essay-rows {
  flex: 1;
  min-width: 0;
  padding: 0 20px;
}
.app-header-row1 {
  display: flex;
  align-items: center;
  height: 30px;
  padding-top: 6px;
  gap: 8px;
  min-width: 0;
}
.app-header-sep {
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.app-header-title {
  font-family: var(--font-ui);
  font-size: 13px;
  font-weight: 600;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.app-header-draft-label {
  font-size: 11px;
  color: var(--color-text-muted);
  flex-shrink: 0;
}
.app-header-row2 {
  display: flex;
  align-items: center;
  height: 26px;
  padding-bottom: 4px;
  gap: 5px;
}
.app-header-avatar-col {
  display: flex;
  align-items: center;
  padding: 0 16px;
}
```

- [ ] **Step 2: Remove the full-bleed override for essay pages**

Find and modify the `.main-content:has(.essay-page)` rule. Change from:
```css
.main-content:has(.essay-page) { max-width: none; padding: 0; }
```
to:
```css
.main-content:has(.essay-page) { max-width: 960px; padding-left: 24px; padding-right: 24px; padding-bottom: 32px; }
```

Also update the child padding rule:
```css
.essay-page > .annotated-essay,
.essay-page > .transition-view, .essay-page > .grammar-view,
.essay-page > .loading-state, .essay-page > .error-state,
.essay-page > .trait-feedback-panel,
.essay-page > .revision-plan-inline,
.essay-page > .revision-layout {
  padding: 16px 24px;
}
```
Change to `padding: 16px 0;` (remove horizontal padding since the container now handles it).

Keep the score bar full-width by moving it outside the max-width container, OR give it negative margins. The simplest approach: the score bar stays inside `.essay-page` but gets `margin: 0 -24px; padding: 10px 24px;` to stretch edge-to-edge within the padded container.

- [ ] **Step 3: Remove old doc-bar and nav-tab styles**

Delete the following CSS rule blocks (they'll be replaced by AppHeader styles):
- `.doc-bar` and all `.doc-bar-*` rules
- `.nav-tab` and `.nav-tab-active` rules
- `.nav-tab-mobile` and `.nav-tab-mobile-active` rules
- `.brand-link` rule

Keep `.doc-bar-draft-menu` and `.doc-bar-draft-item` styles — rename them to `.draft-picker-menu` and `.draft-picker-item` for use in the new AppHeader's draft picker.

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/index.css
git commit -m "style: add unified AppHeader CSS, center essay content, remove old doc-bar/nav-tab styles"
```

---

### Task 3: Update UserAvatarMenu with Progress/Sharing links

**Files:**
- Modify: `src/components/UserAvatarMenu.tsx`

- [ ] **Step 1: Add Progress and Sharing links to the dropdown**

```typescript
import { Menu, Avatar } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function UserAvatarMenu() {
  const { user, logOut } = useAuth();
  const initial = (user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  return (
    <Menu shadow="md" width={180} position="bottom-end">
      <Menu.Target>
        <Avatar
          src={user?.photoURL}
          alt={user?.displayName ?? ''}
          radius="xl"
          size="sm"
          style={{ cursor: 'pointer' }}
        >
          {initial}
        </Avatar>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>{user?.email}</Menu.Label>
        <Menu.Item component={Link} to="/progress">Progress</Menu.Item>
        <Menu.Item component={Link} to="/sharing">Sharing</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={logOut}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/UserAvatarMenu.tsx
git commit -m "feat: add Progress, Sharing, email to avatar dropdown menu"
```

---

### Task 4: Update Layout.tsx — always show header, use AppHeader

**Files:**
- Modify: `src/components/Layout.tsx`

- [ ] **Step 1: Rewrite Layout to always show AppHeader**

Replace the entire file:

```typescript
import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import AppHeader from './AppHeader';

export default function Layout() {
  return (
    <AppShell
      header={{ height: 52 }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader />
      </AppShell.Header>

      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
```

Note: The essay page will need to pass its context to AppHeader. Since Layout wraps all routes via `<Outlet />`, the essay page needs a way to communicate its header content up to Layout.

The cleanest approach: use React context. Create a small `EssayHeaderContext` that EssayPage provides and Layout consumes.

Add to Layout.tsx:

```typescript
import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import AppHeader from './AppHeader';
import { useEssayHeaderContext } from '../hooks/useEssayHeaderContext';

export default function Layout() {
  const essayContext = useEssayHeaderContext();

  return (
    <AppShell
      header={{ height: essayContext ? 60 : 52 }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader essayContext={essayContext ?? undefined} />
      </AppShell.Header>

      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
```

- [ ] **Step 2: Create the EssayHeaderContext hook**

Create `src/hooks/useEssayHeaderContext.tsx`:

```typescript
import { createContext, useContext, useState, type ReactNode } from 'react';

interface DraftOption {
  id: string;
  label: string;
}

interface EssayHeaderState {
  title: string;
  draftLabel: string;
  activeDraftId?: string;
  draftOptions?: DraftOption[];
  onPickDraft?: (id: string) => void;
  toolbar?: ReactNode;
}

interface EssayHeaderContextValue {
  state: EssayHeaderState | null;
  set: (state: EssayHeaderState | null) => void;
}

const EssayHeaderCtx = createContext<EssayHeaderContextValue>({
  state: null,
  set: () => {},
});

export function EssayHeaderProvider({ children }: { children: ReactNode }) {
  const [state, set] = useState<EssayHeaderState | null>(null);
  return (
    <EssayHeaderCtx.Provider value={{ state, set }}>
      {children}
    </EssayHeaderCtx.Provider>
  );
}

export function useEssayHeaderContext() {
  return useContext(EssayHeaderCtx).state;
}

export function useSetEssayHeader() {
  return useContext(EssayHeaderCtx).set;
}
```

Wrap the `<Outlet />` in Layout with `<EssayHeaderProvider>`. Actually, the provider needs to wrap both the header AND the outlet so they share state. Wrap at the Layout level:

```typescript
import { EssayHeaderProvider, useEssayHeaderContext } from '../hooks/useEssayHeaderContext';

export default function Layout() {
  return (
    <EssayHeaderProvider>
      <LayoutInner />
    </EssayHeaderProvider>
  );
}

function LayoutInner() {
  const essayContext = useEssayHeaderContext();
  return (
    <AppShell
      header={{ height: essayContext ? 60 : 52 }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader essayContext={essayContext ?? undefined} />
      </AppShell.Header>
      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
```

- [ ] **Step 3: Verify build**

Run: `npm run build`

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.tsx src/hooks/useEssayHeaderContext.tsx
git commit -m "feat: Layout always shows AppHeader, add EssayHeaderContext for essay pages"
```

---

### Task 5: Update EssayPage to use EssayHeaderContext instead of DocBar

**Files:**
- Modify: `src/pages/EssayPage.tsx`

This is the biggest task — replacing all DocBar usage with the new context system.

- [ ] **Step 1: Replace DocBar import with context hook**

Remove:
```typescript
import DocBar from '../components/DocBar';
```

Add:
```typescript
import { useSetEssayHeader } from '../hooks/useEssayHeaderContext';
```

- [ ] **Step 2: Add useEffect to set essay header context**

After the existing state declarations, add a useEffect that pushes the header content into the context whenever the relevant state changes:

```typescript
const setEssayHeader = useSetEssayHeader();

useEffect(() => {
  setEssayHeader({
    title: essay?.title ?? '',
    draftLabel: revising
      ? '· Revising'
      : activeDraft
        ? `v${activeDraft.draftNumber} — ${relativeTime(activeDraft.submittedAt)}`
        : '',
    activeDraftId: activeDraft?.id,
    draftOptions: drafts.map((d) => ({ id: d.id, label: `v${d.draftNumber} — ${relativeTime(d.submittedAt)}` })),
    onPickDraft: setSelectedDraftId,
    toolbar: (
      <Group gap="xs">
        {revising ? (
          /* revision mode toolbar — Cancel + Resubmit */
          <>...</>
        ) : (
          /* normal mode toolbar — view selector + Analyze + Revise */
          <>...</>
        )}
      </Group>
    ),
  });
  return () => setEssayHeader(null); // Clean up on unmount
}, [essay, activeDraft, drafts, revising, /* other deps */]);
```

The toolbar JSX is the same `<Group gap="xs">` content that's currently inside `<DocBar>...</DocBar>` children. Move it into the context.

- [ ] **Step 3: Remove the DocBar JSX from the render**

Delete the entire `<DocBar ...>...</DocBar>` block from the return statement. The header is now rendered by Layout via the context.

- [ ] **Step 4: Verify build**

Run: `npm run build`

- [ ] **Step 5: Commit**

```bash
git add src/pages/EssayPage.tsx
git commit -m "feat: EssayPage uses EssayHeaderContext instead of DocBar"
```

---

### Task 6: Add draft picker to AppHeader

**Files:**
- Modify: `src/components/AppHeader.tsx`

The draft picker (click version label to switch drafts) needs to be moved from DocBar into AppHeader's essay header.

- [ ] **Step 1: Add draft picker state and UI**

In the `EssayHeader` function, add:
- `useState` for picker open/closed
- `useClickOutside` ref for closing
- The draft picker dropdown menu (same markup as DocBar had)

The draft label becomes clickable when there are multiple draft options:

```tsx
<span className="app-header-draft-label">
  {draftLabel}
  {draftOptions && draftOptions.length > 1 && (
    <button className="app-header-draft-pick" onClick={() => setPickerOpen(!pickerOpen)}>▾</button>
  )}
</span>
{pickerOpen && (
  <div className="draft-picker-menu">
    {draftOptions?.map((opt) => (
      <button
        key={opt.id}
        className={`draft-picker-item ${opt.id === activeDraftId ? 'active' : ''}`}
        onClick={() => { onPickDraft?.(opt.id); setPickerOpen(false); }}
      >
        {opt.label}
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 2: Verify build**

Run: `npm run build`

- [ ] **Step 3: Commit**

```bash
git add src/components/AppHeader.tsx
git commit -m "feat: add draft version picker to AppHeader essay mode"
```

---

### Task 7: Delete DocBar and clean up

**Files:**
- Delete: `src/components/DocBar.tsx`
- Modify: `src/constants.ts`

- [ ] **Step 1: Delete DocBar.tsx**

```bash
rm src/components/DocBar.tsx
```

- [ ] **Step 2: Clean up constants.ts**

Check if `NAV_LINKS` is still imported anywhere. If not (nav tabs removed, avatar menu uses hardcoded links), remove it from constants.ts.

- [ ] **Step 3: Verify build**

Run: `npm run build`
Expected: No remaining imports of DocBar or NAV_LINKS. Build succeeds.

- [ ] **Step 4: Run tests**

Run: `npx vitest run`
Expected: Some tests may fail (Layout tests check for nav tabs, EssayPage tests may reference DocBar). Fix in next task.

- [ ] **Step 5: Commit**

```bash
git add -u src/components/DocBar.tsx src/constants.ts
git commit -m "refactor: delete DocBar, remove unused NAV_LINKS"
```

---

### Task 8: Update tests

**Files:**
- Modify: `src/components/Layout.test.tsx`
- Modify: `src/pages/EssayPage.test.tsx`

- [ ] **Step 1: Update Layout tests**

The existing tests check for:
- Nav tabs (My Essays, Progress, Sharing) in the header — these are gone, remove those assertions
- Header hidden on essay routes — this is no longer true, header is always shown
- "+ New" button — now says "+ New Essay"

Rewrite to match new behavior:
- Brand "EssayCoach" is always present
- "+ New Essay" button is present on home routes
- Header is always visible (on all routes)
- Avatar is always present

- [ ] **Step 2: Update EssayPage tests**

If any tests reference DocBar or its elements, update them. The essay title is now in the AppHeader (via context), not in a DocBar component.

- [ ] **Step 3: Run tests**

Run: `npx vitest run`
Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/components/Layout.test.tsx src/pages/EssayPage.test.tsx
git commit -m "test: update Layout and EssayPage tests for unified header"
```

---

### Task 9: Update theme and final verification

**Files:**
- Modify: `src/theme.ts`

- [ ] **Step 1: Verify AppShell header height works with dynamic values**

The header height differs between home (52px) and essay (60px). Layout.tsx already passes this dynamically via `header={{ height: essayContext ? 60 : 52 }}`. Verify that Mantine's AppShell handles this correctly — the `padding-top` on `AppShell.Main` should adjust.

If `theme.ts` overrides the header height, remove that override (Layout handles it).

- [ ] **Step 2: Run full build**

Run: `npm run build`

- [ ] **Step 3: Run full test suite**

Run: `npx vitest run`

- [ ] **Step 4: Manual smoke test**

1. Navigate to home — verify single-row header (brand + New Essay + avatar)
2. Click avatar — verify dropdown shows email, Progress, Sharing, Sign out
3. Click an essay — verify two-row header (brand › title | toolbar | avatar)
4. Verify warm gray background on essay page
5. Verify essay content is centered (max-width, not full-bleed)
6. Verify score bar stretches edge-to-edge
7. Click EssayCoach brand on essay page — goes home
8. Click Progress in avatar dropdown — navigates to Progress page
9. Test revision mode — verify header updates to show "· Revising"
10. Test draft picker in header — switches drafts

- [ ] **Step 5: Deploy and verify**

```bash
npm run build
firebase deploy --only hosting --project essay-grader-83737x
```

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: unified header layout complete"
```
