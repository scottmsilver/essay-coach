# Toolbar Redesign — Design Spec

## Goal

Condense the EssayPage header into a two-row, Google Docs-style toolbar. Move app-level navigation into a hamburger menu, put essay-specific controls (feedback type, scores, revise) on a dedicated row, and use lighter visual weight throughout.

## Current State

- `Layout.tsx` renders a persistent top navbar with: EssayCoach brand, nav links (New Essay, My Essays, Progress, Sharing), user avatar + sign out.
- `EssayPage.tsx` renders its own `essay-toolbar` with: title, draft `<select>` (showing "D1", "D2"), 2-letter score badges (Id, Org, Vo...), view toggle (Feedback/Transitions/Grammar), and Revise link.
- Two separate bars stacked = a lot of vertical space before the essay content.

## Design

### Row 1 — Document Bar

```
[☰] The American Dream in Modern Literature  [Rev 3 ▾]  ———————  ssilver@...
```

- **Hamburger (☰)**: Opens a dropdown with app-level nav links: New Essay, My Essays, Progress, Sharing, Sign out. Replaces the persistent navbar from `Layout.tsx` on EssayPage.
- **Title**: Essay title, medium weight (500), truncates with ellipsis on small screens.
- **Draft selector**: Shows "Rev 3" collapsed. Dropdown options show relative timestamps:
  - Today: "Rev 3 — 2h ago"
  - Yesterday: "Rev 2 — Yesterday, 4:30 PM"
  - Older: "Rev 1 — Mar 12, 9:15 AM"
- **User info**: Email (from `user.email` via Firebase Auth) and avatar (`user.photoURL`) pinned to far right. No sign-out button visible (it's in the hamburger).

### Row 2 — Analysis Bar

```
[Feedback ▾]  |  Ideas 5  Organization 4  Voice 3  Word Choice 4  Fluency 5  Conventions 4  Presentation 3  |  [Revise]
```

- **Feedback type dropdown**: Left-aligned. Shows current view (Feedback / Transitions / Grammar). Switches the essay view below.
- **Score pills**: Centered, full trait names. Light font weight (400), 10px, muted colors:
  - High (4-6): subtle sage green text on faint green background
  - Mid (3): subtle warm amber text on faint amber background
  - Low (1-2): subtle dusty rose text on faint rose background
  - Click any pill → floating popover with trait name, score/6, and feedback text
  - Delta indicators (+1/-1) preserved on revisions, displayed inside the pill after the score
- **Revise button**: Right-aligned, steel blue (#3b82b6), compact. Only shown on latest draft.

### Visual Style

- Font: Inter (or system-ui fallback), lighter weights throughout
- Score pills: font-weight 400, font-size 10px, letter-spacing 0.02em, very low-opacity backgrounds (0.08 alpha)
- No purple — accent color is muted steel blue (#3b82b6)
- The app uses a light theme. The toolbar rows should use the existing light surface colors (`--color-surface`, `--color-bg`) rather than the dark mockup colors. The mockup was dark for contrast during brainstorming — implementation should match the app's light palette. Row 1 background: `--color-surface` (white). Row 2 background: slightly tinted (e.g., `--color-bg` or a faint gray). Score pill colors (sage/amber/rose) should be adjusted to read well on light backgrounds.

### Hamburger Menu

Dropdown positioned below the ☰ icon:
- New Essay
- My Essays
- Progress
- Sharing
- (divider)
- Sign out

Click-outside dismissal (same pattern as trait popover).

### Draft Selector — Relative Time Logic

- Less than 1 minute: "Just now"
- Less than 1 hour: "Xm ago"
- 1-23 hours: "Xh ago"
- Yesterday: "Yesterday, H:MM AM/PM"
- This year: "Mon DD, H:MM AM/PM"
- Older: "Mon DD, YYYY, H:MM AM/PM"

### Score Popover (unchanged behavior)

Click a score pill → floating popover below it with:
- Header: Trait name (left) + score/6 (right, colored)
- Body: feedback text
- Click outside to dismiss
- Only one popover open at a time

### Layout.tsx Changes

On EssayPage and RevisionPage, the persistent `<nav>` bar should be hidden — replaced by the hamburger in the essay toolbar. Other pages keep the existing navbar.

**Mechanism**: Use `useLocation()` in `Layout.tsx` to detect essay routes (`/essay/` or `/user/.../essay/`). When on an essay route, add a `hide-navbar` class to the `<nav>` element (or skip rendering it). This keeps the `<Outlet />` routing intact and avoids restructuring `App.tsx`.

### RevisionPage

- Row 1: Same as EssayPage (hamburger, title + " — Revision", user). No draft selector — RevisionPage always works on the latest draft.
- Row 2: Score pills centered (with click-to-filter-annotations behavior preserved), **Resubmit** button right-aligned (same position as Revise on EssayPage). No feedback type dropdown (RevisionPage only shows the annotation sidebar). Clicking a score pill continues to open the trait-feedback-panel and filter annotations — this is a working-reference pattern needed during editing, different from the quick-glance popover on EssayPage.

## Files to Modify

- `src/components/Layout.tsx` — Hide navbar on essay routes using `useLocation()`
- `src/pages/EssayPage.tsx` — Replace toolbar with new two-row layout, full trait names, feedback type dropdown, Rev naming, inline draft selector
- `src/pages/RevisionPage.tsx` — Adopt new Row 1, move Resubmit to Row 2
- `src/index.css` — New toolbar styles, muted score colors, hamburger menu styles
- `src/types.ts` — Remove `TRAIT_SHORT_LABELS` (no longer needed)
- `src/utils.ts` — Add `relativeTime(date: Date): string` helper
- `src/pages/EssayPage.test.tsx` — Update assertions for full trait names, new layout structure
- `src/pages/RevisionPage.test.tsx` — Update assertions for new layout
- `src/components/Layout.test.tsx` — Test navbar hiding on essay routes
- `src/components/DraftSelector.tsx` — Delete (not used by EssayPage or RevisionPage; draft selector is inline)
- `src/components/DraftSelector.test.tsx` — Delete

Note: `src/App.tsx` is not modified — Layout route structure stays the same.

## Out of Scope

- Responsive/mobile layout (future work)
- Changing the essay content area or annotation sidebar
- Changes to Transitions or Grammar view content
- Changes to HomePage, NewEssayPage, ProgressPage, SharingPage layouts
- Keyboard accessibility for menus (future improvement)
