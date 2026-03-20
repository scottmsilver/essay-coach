# Unified Header & Layout Harmonization

## Problem

The home view and essay view feel like two different apps. The header shrinks from 56px to 40px, the warm gray background disappears into white, content jumps from a centered 1120px box to full-bleed, and the navigation model changes completely (tab bar vs DocBar). Students experience a visual jolt when moving between views.

Additionally, Progress and Sharing are rarely-used pages that occupy prime header real estate as navigation tabs, creating unnecessary chrome.

## Solution

Adopt a Google Docs-inspired model: one consistent header shell across all pages, with context-specific content in the middle. Bury Progress and Sharing behind the avatar dropdown. Make the warm gray body background universal. Give essay content a max-width so it sits in a centered container like home content.

## Design

### Header — Consistent Shell

All pages share the same header component:
- White background, subtle box-shadow (`0 1px 3px rgba(0,0,0,0.06)`)
- Bottom border `1px solid var(--color-border)`
- "EssayCoach" in Instrument Serif, `#2563EB`, always left-aligned, always clickable → home
- Avatar always in top-right, with dropdown menu containing: email, Progress, Sharing, Sign out

### Home Header (single row, ~52px)

- Left: "EssayCoach" brand
- Right: "+ New Essay" button + avatar
- No navigation tabs — Progress and Sharing are in the avatar dropdown

### Essay Header (connected two-row, ~60px)

Two rows flow as one continuous block — no internal borders, shared white background and shadow.

**Row 1 (~30px, top-padded):** Identity row
- "EssayCoach" brand (clickable → home)
- `›` breadcrumb separator
- Essay title (font-weight: 600, DM Sans, truncated with ellipsis)
- Draft version label with picker (e.g. "v4 ▾", muted color) — clicking opens the existing draft picker dropdown to switch between versions

**Row 2 (~26px, bottom-padded):** Toolbar row
- View selector dropdown (Overall/Transitions/Grammar) — border color is `#2563EB` (same blue as brand), creating a subtle visual connection
- "Analyze" button (outlined)
- "Revise" button (primary blue)

**Avatar** sits on the right side, vertically centered across both rows (~42px circle). No separator line before it.

### New Essay Header

Same as home header but with breadcrumb: "EssayCoach › New Essay"

### Avatar Dropdown Menu

Contains:
- User email (bold, top)
- Progress (link)
- Sharing (link)
- Divider
- Sign out

### Body Background

`var(--color-bg)` (#F8F7F4 warm gray) on ALL pages, including essay pages. Currently essay pages override this with white — remove that override.

### Essay Content Container

Essay page content gets `max-width: 960px` with `margin: 0 auto` and horizontal padding. The annotated essay, feedback summary, and sidebar all sit within this container. White cards on warm gray background — same visual language as home's essay list cards.

The score bar remains full-width (edge to edge) since it's a toolbar-like element, not content.

## What Changes

| File | Action | What |
|------|--------|------|
| `src/components/Layout.tsx` | MODIFY | Show header on all pages (remove essay-route hiding), update header height, remove nav tabs, add avatar dropdown with Progress/Sharing/Sign out |
| `src/components/DocBar.tsx` | DELETE or MODIFY | Merge DocBar into the header component — essay header is now a two-row variant of the main header, not a separate component |
| `src/pages/EssayPage.tsx` | MODIFY | Remove DocBar usage, use new header props for essay context (title, draft, controls) |
| `src/pages/HomePage.tsx` | MODIFY | Remove nav tab references if any |
| `src/App.tsx` | MODIFY | Remove Progress/Sharing from top-level nav (they move to avatar dropdown) |
| `src/components/UserAvatarMenu.tsx` | MODIFY | Add email display, Progress link, Sharing link, divider (currently only has Sign out) |
| `src/index.css` | MODIFY | Remove `.main-content:has(.essay-page)` full-bleed override, add max-width to essay content, update header styles, remove old nav-tab styles, remove mobile drawer styles |
| `src/theme.ts` | MODIFY | Update AppShell header height if needed |

## What Stays the Same

- Score bar (sticky below header, full-width, warm tint)
- Annotated essay + sidebar comment layout
- All essay page functionality (revision mode, skeleton UI, analysis tabs)
- Mantine AppShell as the layout framework

## States

```
Header
  ├── Home: brand + "+ New Essay" + avatar (single row, 52px)
  ├── Essay: brand › title · version | controls | avatar (two-row, ~60px)
  ├── New Essay: brand › "New Essay" + avatar (single row, 52px)
  ├── Progress: brand + avatar (single row, 52px)
  └── Sharing: brand + avatar (single row, 52px)
```

## Edge Cases

- **Long essay titles:** truncate with ellipsis in the header breadcrumb (already designed with `overflow: hidden; text-overflow: ellipsis`)
- **Mobile:** the current hamburger menu / mobile drawer is removed (nav tabs were its only content). On mobile, the header controls should remain accessible — the two-row layout may need to compress. The avatar dropdown with Progress/Sharing works the same on mobile.
- **Shared essays (ownerUid):** header shows the essay title as normal, Revise button hidden (same as current)
- **Old nav tab URLs (/progress, /sharing):** these routes still work, they just aren't in the header anymore — accessible via avatar dropdown
