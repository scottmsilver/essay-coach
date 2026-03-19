# Design System — EssayCoach

## Product Context
- **What this is:** AI essay grading tool using 6+1 Traits of Writing model with Socratic feedback
- **Who it's for:** High school students submitting essays for feedback and revision
- **Space/industry:** EdTech, writing tools (peers: Grammarly, Hemingway, NoRedInk)
- **Project type:** Web app (React + Mantine + Firebase)

## Aesthetic Direction
- **Direction:** Warm Editorial
- **Decoration level:** Intentional — warm paper-tone backgrounds on essay views, clean everywhere else
- **Mood:** A thoughtful writing coach, not an AI grading machine. The essay is the hero. Encouraging, not clinical.
- **Reference sites:** Hemingway (inline color-coded feedback), Grammarly (restrained palette), NoRedInk (classroom-friendly)

## Typography
- **Display/Hero:** Instrument Serif — warm, literary, sets the writing-coach tone. Page titles, brand.
- **Body:** Source Sans 3 — highly readable at body sizes, designed for long-form reading. Essay text.
- **UI/Labels:** DM Sans — clean geometric sans for nav, buttons, labels, score pills.
- **Data/Tables:** DM Sans with tabular-nums
- **Code:** Geist Mono
- **Loading:** Google Fonts CDN (preconnected in index.html)
- **Scale:** 12px (caption) / 13px (meta) / 14px (UI) / 17px (body) / 20px (brand) / 28px (h2) / 36px (h1)

## Color
- **Approach:** Balanced — blue primary for trust, amber accent for celebration
- **Primary:** `#2563EB` — confidence, trust, education. Buttons, active states, links.
- **Accent:** `#F59E0B` — warm amber. Celebrations, score improvements, highlights.
- **Neutrals:** Warm stone grays
  - Background: `#F8F7F4`
  - Surface: `#FFFFFF`
  - Surface warm: `#F5F3EF`
  - Border: `#E7E5E4`
  - Text: `#1C1917`
  - Text secondary: `#78716C`
  - Text muted: `#A8A29E`
- **Semantic:** success `#059669`, warning `#D97706`, error `#DC2626`
- **Dark mode:** Not yet implemented. Strategy: warm dark surfaces (#1C1917 bg), reduce saturation 10-20%.

## Spacing
- **Base unit:** 8px
- **Density:** Comfortable
- **Scale:** xs(4) sm(8) md(16) lg(24) xl(32)
- **Essay text:** Extra generous line-height (1.8) and paragraph spacing

## Layout
- **Approach:** Hybrid — grid-disciplined for list/form pages, editorial for essay reading
- **Max content width:** 1120px (list pages), 680px (essay reading column)
- **Border radius:** sm:4px, md:6px, lg:8px, xl:12px, pill:10px (score pills)

## Motion
- **Approach:** Intentional — not playful, not minimal
- **Score pills:** Animate in on load
- **Celebration glow:** Warm amber glow when scores improve
- **Delta bounce:** Score change numbers bounce in with ease-out
- **Transitions:** 150ms for hover states, 300ms for view changes
- **Easing:** enter(ease-out) exit(ease-in) move(ease-in-out)

## Information Architecture
- **Header tabs:** My Essays | Progress | Sharing (views only, no actions)
- **"+ New Essay":** Button in header, not a tab
- **Essay pages:** DocBar replaces header. Back arrow (←) for returning home. Burger for full nav.
- **Sub-navigation:** Overall / Transitions / Grammar via dropdown on essay pages

## Theme Files
- `src/theme.ts` — Mantine theme overrides (colors, fonts, radius, spacing)
- `src/index.css` `:root` — CSS custom properties for all design tokens
- `index.html` — Google Fonts loading

To retheme: modify CSS custom properties in `:root` and the Mantine theme in `src/theme.ts`.

## Decisions Log
| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-03-18 | Warm Editorial aesthetic | Hemingway-inspired, distinguishes from clinical edtech tools |
| 2026-03-18 | Instrument Serif for display | Literary tone, signals "this is about writing" |
| 2026-03-18 | Blue primary over purple | Trust/education (Canvas, Google Classroom), avoids AI-purple slop |
| 2026-03-18 | Amber celebration over green | Emotionally warmer "well done" vs clinical checkbox |
| 2026-03-18 | New Essay as button, not tab | Tabs are views, buttons are actions — consistent IA |
| 2026-03-18 | Back arrow in DocBar | Essay pages need a visible way home without opening burger |
