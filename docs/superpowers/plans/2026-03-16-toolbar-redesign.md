# Toolbar Redesign Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Condense the EssayPage and RevisionPage headers into a two-row Google Docs-style toolbar with hamburger nav, full trait names, feedback type dropdown, and "Rev N" draft naming with relative timestamps.

**Architecture:** Hide Layout's navbar on essay routes via `useLocation()`. EssayPage gets a new two-row toolbar (document bar + analysis bar). RevisionPage adopts the same document bar. Shared `relativeTime()` utility formats draft timestamps.

**Tech Stack:** React, react-router-dom, CSS custom properties, vitest

---

## Chunk 1: Toolbar Redesign

### Task 1: Add `relativeTime` utility

**Files:**
- Modify: `src/utils.ts`

- [ ] **Step 1: Write test for relativeTime**

Add to a new test file `src/utils.test.ts`:

```typescript
import { describe, it, expect, vi, afterEach } from 'vitest';
import { relativeTime } from './utils';

describe('relativeTime', () => {
  afterEach(() => { vi.useRealTimers(); });

  it('returns "Just now" for < 1 minute ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:30Z'));
    expect(relativeTime(new Date('2026-03-16T12:00:00Z'))).toBe('Just now');
  });

  it('returns "Xm ago" for < 1 hour ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:25:00Z'));
    expect(relativeTime(new Date('2026-03-16T12:00:00Z'))).toBe('25m ago');
  });

  it('returns "Xh ago" for 1-23 hours ago', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T15:00:00Z'));
    expect(relativeTime(new Date('2026-03-16T12:00:00Z'))).toBe('3h ago');
  });

  it('returns "Yesterday, H:MM AM/PM" for yesterday', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    const result = relativeTime(new Date('2026-03-15T16:30:00Z'));
    expect(result).toMatch(/^Yesterday,/);
  });

  it('returns "Mon DD, H:MM AM/PM" for older dates this year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    const result = relativeTime(new Date('2026-02-10T09:15:00Z'));
    expect(result).toMatch(/Feb 10/);
  });

  it('returns "Mon DD, YYYY, H:MM AM/PM" for dates in a prior year', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-03-16T12:00:00Z'));
    const result = relativeTime(new Date('2025-06-05T14:00:00Z'));
    expect(result).toMatch(/2025/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils.test.ts`
Expected: FAIL — `relativeTime` is not exported from `./utils`

- [ ] **Step 3: Implement relativeTime**

Add to `src/utils.ts`:

```typescript
export function relativeTime(date: Date): string {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffHr = Math.floor(diffMs / 3600000);

  if (diffMin < 1) return 'Just now';
  if (diffMin < 60) return `${diffMin}m ago`;
  if (diffHr < 24) return `${diffHr}h ago`;

  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.getDate() === yesterday.getDate()
    && date.getMonth() === yesterday.getMonth()
    && date.getFullYear() === yesterday.getFullYear();

  const timeStr = date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  if (isYesterday) return `Yesterday, ${timeStr}`;

  if (date.getFullYear() === now.getFullYear()) {
    const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    return `${dateStr}, ${timeStr}`;
  }

  const dateStr = date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return `${dateStr}, ${timeStr}`;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/utils.test.ts`
Expected: PASS

---

### Task 2: Hide Layout navbar on essay routes

**Files:**
- Modify: `src/components/Layout.tsx`
- Modify: `src/components/Layout.test.tsx`

- [ ] **Step 1: Update Layout.test.tsx**

Replace the existing test file with:

```typescript
import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import Layout from './Layout';

describe('Layout', () => {
  it('renders the brand name', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('EssayCoach')).toBeInTheDocument();
  });

  it('renders navigation links', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText('New Essay')).toBeInTheDocument();
    expect(screen.getByText('My Essays')).toBeInTheDocument();
    expect(screen.getByText('Progress')).toBeInTheDocument();
  });

  it('renders sign out button', () => {
    renderWithRouter(<Layout />);
    expect(screen.getByText(/sign out/i)).toBeInTheDocument();
  });

  it('hides navbar on essay routes', () => {
    renderWithRouter(<Layout />, { route: '/essay/e1' });
    const nav = document.querySelector('.navbar');
    expect(nav).toHaveClass('navbar-hidden');
  });

  it('hides navbar on shared essay routes', () => {
    renderWithRouter(<Layout />, { route: '/user/u1/essay/e1' });
    const nav = document.querySelector('.navbar');
    expect(nav).toHaveClass('navbar-hidden');
  });

  it('shows navbar on non-essay routes', () => {
    renderWithRouter(<Layout />, { route: '/' });
    const nav = document.querySelector('.navbar');
    expect(nav).not.toHaveClass('navbar-hidden');
  });
});
```

- [ ] **Step 2: Run tests to verify new tests fail**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: FAIL — `navbar-hidden` class does not exist yet

- [ ] **Step 3: Implement navbar hiding in Layout.tsx**

Replace `src/components/Layout.tsx` with:

```typescript
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Layout() {
  const { user, logOut } = useAuth();
  const { pathname } = useLocation();
  const isEssayRoute = /\/(essay|user\/[^/]+\/essay)\//.test(pathname);

  return (
    <div className="app">
      <nav className={`navbar ${isEssayRoute ? 'navbar-hidden' : ''}`}>
        <div className="nav-content">
          <div className="nav-brand">EssayCoach</div>
          <div className="nav-links">
            <NavLink to="/new">New Essay</NavLink>
            <NavLink to="/">My Essays</NavLink>
            <NavLink to="/progress">Progress</NavLink>
            <NavLink to="/sharing">Sharing</NavLink>
          </div>
          <div className="nav-user">
            {user?.photoURL && <img src={user.photoURL} alt="" className="avatar" />}
            <button onClick={logOut} className="sign-out-btn">Sign out</button>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
```

- [ ] **Step 4: Add CSS for navbar-hidden**

Add to `src/index.css` after the `.navbar` block (around line 33):

```css
.navbar.navbar-hidden {
  display: none;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/components/Layout.test.tsx`
Expected: PASS (6 tests)

---

### Task 3: Remove DraftSelector and TRAIT_SHORT_LABELS from types.ts

**Files:**
- Modify: `src/types.ts` — remove `TRAIT_SHORT_LABELS`
- Delete: `src/components/DraftSelector.tsx`
- Delete: `src/components/DraftSelector.test.tsx`

- [ ] **Step 1: Remove TRAIT_SHORT_LABELS from types.ts**

Delete lines 25-33 of `src/types.ts` (the `TRAIT_SHORT_LABELS` constant).

- [ ] **Step 2: Delete DraftSelector files**

Delete `src/components/DraftSelector.tsx` and `src/components/DraftSelector.test.tsx`.

Note: Do NOT remove the `TRAIT_SHORT_LABELS` import from EssayPage.tsx yet — line 230 still uses it. That import and usage will both be removed together in Task 4 when the toolbar JSX is rewritten.

---

### Task 4: Rewrite EssayPage toolbar

**Files:**
- Modify: `src/pages/EssayPage.tsx`
- Modify: `src/pages/EssayPage.test.tsx`
- Modify: `src/index.css`

- [ ] **Step 1: Update EssayPage.test.tsx for new layout**

Replace the test file with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import type { Evaluation, TraitEvaluation } from '../types';

const makeTrait = (score: number, priority: number | null): TraitEvaluation => ({
  score, feedback: `Feedback for score ${score}`, revisionPriority: priority,
  annotations: [{ quotedText: 'sample', comment: 'comment' }],
});

const mockEval: Evaluation = {
  traits: {
    ideas: makeTrait(4, null), organization: makeTrait(3, 2), voice: makeTrait(5, null),
    wordChoice: makeTrait(3, 3), sentenceFluency: makeTrait(4, null),
    conventions: makeTrait(2, 1), presentation: makeTrait(4, null),
  },
  overallFeedback: 'Overall feedback text',
  revisionPlan: ['Fix conventions', 'Improve organization'],
  comparisonToPrevious: null,
};

let mockEssayState = {
  essay: { id: 'e1', title: 'Test Essay', writingType: 'argumentative', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
  drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay text with sample quoted here', submittedAt: new Date(), evaluation: mockEval as Evaluation | null, revisionStage: null }],
  loading: false,
};

vi.mock('../hooks/useEssay', () => ({
  useEssay: () => mockEssayState,
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ essayId: 'e1' }) };
});

import EssayPage from './EssayPage';

describe('EssayPage', () => {
  beforeEach(() => {
    mockEssayState = {
      essay: { id: 'e1', title: 'Test Essay', writingType: 'argumentative', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
      drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay text with sample quoted here', submittedAt: new Date(), evaluation: mockEval as Evaluation | null, revisionStage: null }],
      loading: false,
    };
  });

  it('renders essay title', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Test Essay')).toBeInTheDocument();
  });

  it('renders all 7 trait score pills with full names', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Ideas')).toBeInTheDocument();
    expect(screen.getByText('Organization')).toBeInTheDocument();
    expect(screen.getByText('Voice')).toBeInTheDocument();
    expect(screen.getByText('Word Choice')).toBeInTheDocument();
    expect(screen.getByText('Sentence Fluency')).toBeInTheDocument();
    expect(screen.getByText('Conventions')).toBeInTheDocument();
    expect(screen.getByText('Presentation')).toBeInTheDocument();
  });

  it('renders hamburger menu button', () => {
    const { container } = renderWithRouter(<EssayPage />);
    expect(container.querySelector('.hamburger-btn')).toBeInTheDocument();
  });

  it('renders feedback type dropdown', () => {
    const { container } = renderWithRouter(<EssayPage />);
    const dropdown = container.querySelector('.view-dropdown');
    expect(dropdown).toBeInTheDocument();
    expect(dropdown?.textContent).toContain('Feedback');
  });

  it('renders revision plan', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/fix conventions/i)).toBeInTheDocument();
  });

  it('renders overall feedback', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText('Overall feedback text')).toBeInTheDocument();
  });

  it('renders Revise button for latest draft', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/^revise$/i)).toBeInTheDocument();
  });

  it('renders user email', () => {
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/test@gmail\.com/)).toBeInTheDocument();
  });

  it('shows loading state for recent draft with null evaluation', () => {
    mockEssayState = {
      ...mockEssayState,
      drafts: [{ ...mockEssayState.drafts[0], evaluation: null, submittedAt: new Date() }],
    };
    renderWithRouter(<EssayPage />);
    expect(screen.getByText(/evaluating/i)).toBeInTheDocument();
  });

  it('shows error state for old draft with null evaluation', () => {
    mockEssayState = {
      ...mockEssayState,
      drafts: [{ ...mockEssayState.drafts[0], evaluation: null, submittedAt: new Date(Date.now() - 300000) }],
    };
    renderWithRouter(<EssayPage />);
    expect(screen.getAllByText(/failed|retry/i).length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/EssayPage.test.tsx`
Expected: FAIL — new assertions don't match old markup

- [ ] **Step 3: Rewrite EssayPage toolbar markup**

In `src/pages/EssayPage.tsx`, make these changes:

**Imports** — update:
- Line 8: change `import { scoreLevel, scoreColor } from '../utils'` to `import { scoreLevel, scoreColor, relativeTime } from '../utils'`
- Line 9: change `import { TRAIT_KEYS, TRAIT_LABELS, TRAIT_SHORT_LABELS } from '../types'` to `import { TRAIT_KEYS, TRAIT_LABELS } from '../types'`

**Add hamburger state** after line 25 (`activeView` state):
```typescript
const [menuOpen, setMenuOpen] = useState(false);
const menuRef = useRef<HTMLDivElement>(null);
```

**Add click-outside for hamburger menu** — add a new `useEffect` after the popover one:
```typescript
useEffect(() => {
  if (!menuOpen) return;
  const handler = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [menuOpen]);
```

**Replace the toolbar JSX** (lines 202-282) with:

```tsx
{/* Row 1 — Document bar */}
<div className="doc-bar">
  <div className="doc-bar-left">
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button className="hamburger-btn" onClick={() => setMenuOpen(!menuOpen)}>
        &#9776;
      </button>
      {menuOpen && (
        <div className="hamburger-menu">
          <Link to="/new" className="hamburger-item" onClick={() => setMenuOpen(false)}>New Essay</Link>
          <Link to="/" className="hamburger-item" onClick={() => setMenuOpen(false)}>My Essays</Link>
          <Link to="/progress" className="hamburger-item" onClick={() => setMenuOpen(false)}>Progress</Link>
          <Link to="/sharing" className="hamburger-item" onClick={() => setMenuOpen(false)}>Sharing</Link>
          <div className="hamburger-divider" />
          <button className="hamburger-item" onClick={() => { setMenuOpen(false); /* logOut handled via auth */ }}>Sign out</button>
        </div>
      )}
    </div>
    <h2 className="doc-bar-title">{essay.title}</h2>
    {drafts.length > 1 && (
      <select
        className="doc-bar-draft"
        value={activeDraftId}
        onChange={(e) => setSelectedDraftId(e.target.value)}
      >
        {drafts.map((d) => (
          <option key={d.id} value={d.id}>
            Rev {d.draftNumber} — {relativeTime(d.submittedAt)}
          </option>
        ))}
      </select>
    )}
  </div>
  <div className="doc-bar-right">
    <span className="doc-bar-user">{user?.email}</span>
  </div>
</div>

{/* Row 2 — Analysis bar */}
<div className="analysis-bar">
  <div className="analysis-bar-left">
    <select
      className="view-dropdown"
      value={activeView}
      onChange={(e) => {
        const view = e.target.value as 'feedback' | 'transitions' | 'grammar';
        if (view === 'transitions') handleTransitionsTab();
        else if (view === 'grammar') handleGrammarTab();
        else setActiveView('feedback');
      }}
    >
      <option value="feedback">Feedback</option>
      <option value="transitions">Transitions</option>
      <option value="grammar">Grammar</option>
    </select>
  </div>
  <div className="analysis-bar-scores">
    {TRAIT_KEYS.map((trait) => {
      const score = evaluation.traits[trait].score;
      const isActive = activeTrait === trait;
      const change = comparison?.scoreChanges[trait];
      return (
        <div key={trait} style={{ position: 'relative' }}>
          <button
            className={`score-pill ${scoreLevel(score)} ${isActive ? 'active' : ''}`}
            onClick={() => setActiveTrait(isActive ? null : trait)}
          >
            <span className="score-pill-label">{TRAIT_LABELS[trait]}</span>
            <span className="score-pill-value">{score}</span>
            {change && change.delta !== 0 && (
              <span className={`score-pill-delta ${change.delta > 0 ? 'up' : 'down'}`}>
                {change.delta > 0 ? '+' : ''}{change.delta}
              </span>
            )}
          </button>
          {isActive && (
            <div className="trait-popover" ref={popoverRef}>
              <div className="trait-popover-header">
                <strong>{TRAIT_LABELS[trait]}</strong>
                <span style={{ color: scoreColor(score), fontWeight: 700 }}>{score}/6</span>
              </div>
              <p className="trait-popover-text">{evaluation.traits[trait].feedback}</p>
            </div>
          )}
        </div>
      );
    })}
  </div>
  <div className="analysis-bar-right">
    {isLatestDraft && (
      <Link
        to={ownerUid ? `/user/${ownerUid}/essay/${essayId}/revise` : `/essay/${essayId}/revise`}
        className="btn-accent btn-compact"
      >
        Revise
      </Link>
    )}
  </div>
</div>
```

**Additional changes in EssayPage.tsx:**

1. Destructure `logOut` from `useAuth()` — change line 19 to:
```typescript
const { user, logOut } = useAuth();
```

2. Update the Sign out hamburger item to call logOut:
```tsx
<button className="hamburger-item" onClick={() => { setMenuOpen(false); logOut(); }}>Sign out</button>
```

3. **Fix click-outside handler** — in the existing `useEffect` for popover dismissal (lines 33-43), change `.score-badge` to `.score-pill`:
```typescript
const badge = (e.target as Element)?.closest?.('.score-pill');
```

- [ ] **Step 4: Add CSS for new toolbar**

Add to `src/index.css` (replace the old `.essay-toolbar*` blocks with):

```css
/* ═══ Document Bar (Row 1) ═══ */
.doc-bar {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  background: var(--color-surface);
  border-bottom: 1px solid var(--color-border);
  gap: 8px;
}
.doc-bar-left {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
  flex: 1;
}
.doc-bar-title {
  font-size: 13px;
  font-weight: 500;
  color: var(--color-text);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  margin: 0;
  letter-spacing: 0.01em;
}
.doc-bar-draft {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 400;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: var(--font-family);
  white-space: nowrap;
}
.doc-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.doc-bar-user {
  font-size: 10px;
  color: var(--color-text-secondary);
  white-space: nowrap;
}

/* Hamburger */
.hamburger-btn {
  background: none;
  border: none;
  font-size: 16px;
  color: var(--color-text-secondary);
  cursor: pointer;
  padding: 2px 5px;
  border-radius: 3px;
  line-height: 1;
}
.hamburger-btn:hover {
  background: var(--color-bg);
}
.hamburger-menu {
  position: absolute;
  top: 100%;
  left: 0;
  margin-top: 4px;
  background: var(--color-surface);
  border: 1px solid var(--color-border);
  border-radius: 6px;
  box-shadow: 0 4px 16px rgba(0,0,0,0.12);
  z-index: 100;
  min-width: 160px;
  display: flex;
  flex-direction: column;
}
.hamburger-item {
  display: block;
  width: 100%;
  padding: 7px 14px;
  font-size: 12px;
  color: var(--color-text-secondary);
  text-decoration: none;
  background: none;
  border: none;
  text-align: left;
  cursor: pointer;
  font-family: var(--font-family);
}
.hamburger-item:hover {
  background: var(--color-bg);
  color: var(--color-text);
}
.hamburger-divider {
  height: 1px;
  background: var(--color-border);
  margin: 2px 0;
}

/* ═══ Analysis Bar (Row 2) ═══ */
.analysis-bar {
  display: flex;
  align-items: center;
  padding: 3px 12px;
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  gap: 8px;
}
.analysis-bar-left {
  flex-shrink: 0;
}
.analysis-bar-scores {
  display: flex;
  gap: 5px;
  flex: 1;
  justify-content: center;
  flex-wrap: wrap;
  align-items: center;
}
.analysis-bar-right {
  flex-shrink: 0;
}

/* View dropdown */
.view-dropdown {
  padding: 2px 8px;
  font-size: 10px;
  font-weight: 400;
  border: 1px solid var(--color-border);
  border-radius: 4px;
  background: var(--color-surface);
  color: var(--color-text-secondary);
  font-family: var(--font-family);
  letter-spacing: 0.02em;
}

/* Score pills — muted, lightweight */
.score-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 10px;
  font-weight: 400;
  letter-spacing: 0.02em;
  border: none;
  cursor: pointer;
  transition: all 0.15s;
  font-family: var(--font-family);
}
.score-pill:hover {
  opacity: 0.85;
}
.score-pill.active {
  outline: 1px solid;
}

/* Muted score colors on light background */
.score-pill.high {
  background: rgba(34, 120, 60, 0.08);
  color: #2d6a3e;
}
.score-pill.high.active {
  background: rgba(34, 120, 60, 0.14);
  outline-color: rgba(34, 120, 60, 0.4);
}
.score-pill.mid {
  background: rgba(160, 120, 20, 0.08);
  color: #8a6d1b;
}
.score-pill.mid.active {
  background: rgba(160, 120, 20, 0.14);
  outline-color: rgba(160, 120, 20, 0.4);
}
.score-pill.low {
  background: rgba(160, 50, 50, 0.08);
  color: #944040;
}
.score-pill.low.active {
  background: rgba(160, 50, 50, 0.14);
  outline-color: rgba(160, 50, 50, 0.4);
}

.score-pill-label {
  font-weight: 400;
}
.score-pill-value {
  font-weight: 600;
}
.score-pill-delta {
  font-size: 9px;
  font-weight: 500;
}
.score-pill-delta.up { color: #2d6a3e; }
.score-pill-delta.down { color: #944040; }

/* Accent button (replaces purple btn-primary in toolbar) */
.btn-accent {
  background: #3b82b6;
  color: white;
  border: none;
  border-radius: 4px;
  padding: 3px 10px;
  font-size: 10px;
  font-weight: 500;
  cursor: pointer;
  font-family: var(--font-family);
  letter-spacing: 0.02em;
  text-decoration: none;
  white-space: nowrap;
}
.btn-accent:hover {
  background: #2d6d9e;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npx vitest run src/pages/EssayPage.test.tsx`
Expected: PASS

- [ ] **Step 6: Run all tests + type check**

Run: `npx tsc -b --noEmit && npx vitest run`
Expected: All pass

---

### Task 5: Update RevisionPage toolbar

**Files:**
- Modify: `src/pages/RevisionPage.tsx`
- Modify: `src/pages/RevisionPage.test.tsx`

- [ ] **Step 1: Update RevisionPage.test.tsx**

Replace the test file with:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import type { Evaluation, TraitEvaluation } from '../types';

const makeTrait = (score: number, priority: number | null): TraitEvaluation => ({
  score, feedback: `Feedback ${score}`, revisionPriority: priority,
  annotations: [{ quotedText: 'quoted passage', comment: 'fix this' }],
});

const mockEval: Evaluation = {
  traits: {
    ideas: makeTrait(4, null), organization: makeTrait(3, 2), voice: makeTrait(5, null),
    wordChoice: makeTrait(3, 3), sentenceFluency: makeTrait(4, null),
    conventions: makeTrait(2, 1), presentation: makeTrait(4, null),
  },
  overallFeedback: 'Overall', revisionPlan: ['Fix conventions'], comparisonToPrevious: null,
};

vi.mock('../hooks/useEssay', () => ({
  useEssay: () => ({
    essay: { id: 'e1', title: 'Test Essay', writingType: 'analytical', currentDraftNumber: 1, createdAt: new Date(), updatedAt: new Date(), assignmentPrompt: 'Prompt' },
    drafts: [{ id: 'd1', draftNumber: 1, content: 'Essay content with quoted passage here.', submittedAt: new Date(), evaluation: mockEval, revisionStage: null }],
    loading: false,
  }),
}));

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual('react-router-dom');
  return { ...actual, useParams: () => ({ essayId: 'e1' }), useNavigate: () => vi.fn() };
});

vi.mock('firebase/functions', () => ({
  httpsCallable: () => vi.fn().mockResolvedValue({ data: {} }),
}));

import RevisionPage from './RevisionPage';

describe('RevisionPage', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('renders the essay title with Revision', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/test essay/i)).toBeInTheDocument();
    expect(screen.getByText(/revision/i)).toBeInTheDocument();
  });

  it('renders hamburger menu button', () => {
    const { container } = renderWithRouter(<RevisionPage />);
    expect(container.querySelector('.hamburger-btn')).toBeInTheDocument();
  });

  it('renders trait score pills with full names', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getAllByText(/conventions/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/organization/i).length).toBeGreaterThan(0);
  });

  it('renders the essay text in a textarea', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByDisplayValue(/essay content/i)).toBeInTheDocument();
  });

  it('renders feedback panel', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/fix this/i)).toBeInTheDocument();
  });

  it('renders Resubmit button in analysis bar', () => {
    renderWithRouter(<RevisionPage />);
    expect(screen.getByText(/resubmit/i)).toBeInTheDocument();
  });

  it('saves to localStorage on edit (autosave)', async () => {
    renderWithRouter(<RevisionPage />);
    const textarea = screen.getByDisplayValue(/essay content/i);
    await userEvent.type(textarea, ' new text');
    expect(localStorage.getItem('essaycoach_autosave_e1')).toContain('new text');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/pages/RevisionPage.test.tsx`
Expected: FAIL — hamburger-btn not found

- [ ] **Step 3: Rewrite RevisionPage header**

In `src/pages/RevisionPage.tsx`:

Add imports:
```typescript
import { Link } from 'react-router-dom';
```
(Already has `useNavigate`; add `Link` to the destructure on line 2.)

Add hamburger state and click-outside effect (same pattern as EssayPage):
```typescript
const [menuOpen, setMenuOpen] = useState(false);
const menuRef = useRef<HTMLDivElement>(null);

useEffect(() => {
  if (!menuOpen) return;
  const handler = (e: MouseEvent) => {
    if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
      setMenuOpen(false);
    }
  };
  document.addEventListener('mousedown', handler);
  return () => document.removeEventListener('mousedown', handler);
}, [menuOpen]);
```

Destructure `logOut` from `useAuth()`:
```typescript
const { user, logOut } = useAuth();
```

Replace the header (lines 108-116), the error div (line 118), and score-strip (lines 120-139) with the following. (The error div is re-created between doc-bar and analysis-bar in the new markup.)

```tsx
{/* Row 1 — Document bar */}
<div className="doc-bar">
  <div className="doc-bar-left">
    <div style={{ position: 'relative' }} ref={menuRef}>
      <button className="hamburger-btn" onClick={() => setMenuOpen(!menuOpen)}>
        &#9776;
      </button>
      {menuOpen && (
        <div className="hamburger-menu">
          <Link to="/new" className="hamburger-item" onClick={() => setMenuOpen(false)}>New Essay</Link>
          <Link to="/" className="hamburger-item" onClick={() => setMenuOpen(false)}>My Essays</Link>
          <Link to="/progress" className="hamburger-item" onClick={() => setMenuOpen(false)}>Progress</Link>
          <Link to="/sharing" className="hamburger-item" onClick={() => setMenuOpen(false)}>Sharing</Link>
          <div className="hamburger-divider" />
          <button className="hamburger-item" onClick={() => { setMenuOpen(false); logOut(); }}>Sign out</button>
        </div>
      )}
    </div>
    <h2 className="doc-bar-title">{essay.title} — Revision</h2>
  </div>
  <div className="doc-bar-right">
    <span className="doc-bar-user">{user?.email}</span>
  </div>
</div>

{error && <div className="error-state" style={{ marginBottom: 0, padding: '4px 12px', fontSize: 12 }}>{error}</div>}

{/* Row 2 — Score pills + Resubmit */}
<div className="analysis-bar">
  <div className="analysis-bar-scores">
    {TRAIT_KEYS.map((trait) => {
      const score = evaluation.traits[trait].score;
      const isActive = selectedTrait === trait;
      const priority = evaluation.traits[trait].revisionPriority;
      return (
        <button
          key={trait}
          className={`score-pill ${scoreLevel(score)} ${isActive ? 'active' : ''}`}
          onClick={() => setSelectedTrait(isActive ? null : trait)}
          title={evaluation.traits[trait].feedback}
        >
          <span className="score-pill-label">{TRAIT_LABELS[trait]}</span>
          <span className="score-pill-value">{score}</span>
          {priority && <span className="score-pill-priority">#{priority}</span>}
        </button>
      );
    })}
  </div>
  <div className="analysis-bar-right">
    <button onClick={handleResubmit} className="btn-accent btn-compact" disabled={submitting || retryCount >= 3}>
      {submitting ? 'Evaluating...' : 'Resubmit'}
    </button>
  </div>
</div>
```

Add CSS for score-pill-priority (add to index.css after score-pill-delta):
```css
.score-pill-priority {
  font-size: 9px;
  font-weight: 500;
  color: var(--color-text-secondary);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/pages/RevisionPage.test.tsx`
Expected: PASS

---

### Task 6: Clean up old CSS and run full verification

**Files:**
- Modify: `src/index.css`

- [ ] **Step 1: Remove old toolbar CSS**

Remove these class blocks from `src/index.css` (all replaced by doc-bar/analysis-bar/score-pill):
- `.essay-toolbar` and all `.essay-toolbar-*` sub-classes
- `.score-strip`
- `.score-badge` and all `.score-badge-*` sub-classes (including `.score-badge.compact`)
- `.view-toggle` and `.view-toggle-btn` (replaced by `.view-dropdown`)
- `.essay-page-header` and `.essay-page-title` (replaced by `.doc-bar`)

Keep:
- `.trait-popover` and children (still used)
- `.trait-feedback-panel` and children (still used by RevisionPage)

- [ ] **Step 2: Run full type check**

Run: `npx tsc -b --noEmit`
Expected: Clean

- [ ] **Step 3: Run all tests**

Run: `npx vitest run`
Expected: All pass

- [ ] **Step 4: Build**

Run: `npx vite build`
Expected: Build succeeds

- [ ] **Step 5: Manual verification checklist**

After deploying, verify in browser:
- [ ] EssayPage: Layout navbar is hidden
- [ ] EssayPage: Hamburger opens with nav links + sign out
- [ ] EssayPage: Draft selector shows "Rev N — relative time"
- [ ] EssayPage: Score pills show full names with muted colors
- [ ] EssayPage: Clicking a pill opens the popover
- [ ] EssayPage: View dropdown switches between Feedback/Transitions/Grammar
- [ ] EssayPage: Revise button appears on latest draft
- [ ] EssayPage: User email shown far right
- [ ] RevisionPage: Same doc-bar with hamburger
- [ ] RevisionPage: Score pills filter annotations
- [ ] RevisionPage: Resubmit button on analysis bar
- [ ] HomePage: Layout navbar still visible
- [ ] SharingPage: Layout navbar still visible
