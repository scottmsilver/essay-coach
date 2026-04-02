# Color Semantics Alignment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make color meaning consistent across scores, transitions, and sidebar report counts without changing layout or adding new visible UI.

**Architecture:** Keep the current structure intact and tighten semantics in place. Put the new score ladder and tooltip copy behind shared helpers in `src/utils.ts`, then wire existing components to those helpers, and finally align the remaining CSS-driven status surfaces to the same red / amber / green system.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Testing Library, CSS custom properties

---

## File Structure

### Existing files to modify

- `src/utils.ts`
  - Owns shared score semantics helpers.
  - Will become the single source of truth for score level, score color, and score tooltip copy.
- `src/utils.test.ts`
  - Currently tests only `relativeTime()`.
  - Will gain the failing tests for the score helper changes first.
- `src/components/ScorePillBar.tsx`
  - Existing score pill renderer.
  - Will consume shared tooltip helper.
- `src/components/TraitCard.tsx`
  - Existing trait card score display.
  - Will consume shared tooltip helper.
- `src/pages/EssayPage.tsx`
  - Existing active-trait popover score display.
  - Will consume shared tooltip helper.
- `src/components/TraitCard.test.tsx`
  - Existing component test file.
  - Will be extended for tooltip assertions and the new `4 => mid` class behavior.
- `src/index.css`
  - Owns transition colors and sidebar count colors.
  - Will align `adequate` transitions and sidebar counts to the approved semantics.
- `src/components/CoachDrawer.tsx`
  - Existing sidebar report count class selection.
  - May need only threshold/class-name wiring changes, not layout changes.

### New files to create

- `src/components/ScorePillBar.test.tsx`
  - Focused tests for score pill tooltip wiring and `score-mid` behavior for score `4`.
- `src/components/CoachDrawer.test.tsx`
  - Focused tests for sidebar count class selection so color semantics are not verified only by manual QA.

---

### Task 1: Lock Score Semantics In Shared Helpers

**Files:**
- Modify: `src/utils.ts`
- Modify: `src/utils.test.ts`

- [ ] **Step 1: Write the failing helper tests**

Add tests in `src/utils.test.ts` for:

- `scoreLevel(1)` => `low`
- `scoreLevel(2)` => `low`
- `scoreLevel(3)` => `mid`
- `scoreLevel(4)` => `mid`
- `scoreLevel(5)` => `high`
- `scoreColor(4)` => `var(--color-yellow)`
- `scoreColor(5)` => `var(--color-green)`
- `scoreTooltip(2)` => `1-2: major problems`
- `scoreTooltip(4)` => `3-4: developing / capable`
- `scoreTooltip(6)` => `5-6: strong / clear`

- [ ] **Step 2: Run the helper test file to verify it fails**

Run: `npm test -- src/utils.test.ts`

Expected:
- FAIL because `scoreLevel(4)` currently returns `high`
- FAIL because `scoreColor(4)` currently returns green
- FAIL because `scoreTooltip()` does not exist yet

- [ ] **Step 3: Implement the minimal helper changes**

In `src/utils.ts`:

- change `scoreLevel()` to `<= 2 => low`, `<= 4 => mid`, else `high`
- change `scoreColor()` to `<= 2 => red`, `<= 4 => yellow`, else `green`
- add `scoreTooltip(score: number): string`

Use the smallest implementation that matches the approved copy:

```ts
export function scoreTooltip(score: number): string {
  if (score <= 2) return '1-2: major problems';
  if (score <= 4) return '3-4: developing / capable';
  return '5-6: strong / clear';
}
```

- [ ] **Step 4: Run the helper test file to verify it passes**

Run: `npm test -- src/utils.test.ts`

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add src/utils.ts src/utils.test.ts
git commit -m "feat: align shared score color semantics"
```

---

### Task 2: Wire Score Tooltips Into Existing Score Surfaces

**Files:**
- Modify: `src/components/ScorePillBar.tsx`
- Modify: `src/components/TraitCard.tsx`
- Modify: `src/pages/EssayPage.tsx`
- Create: `src/components/ScorePillBar.test.tsx`
- Modify: `src/components/TraitCard.test.tsx`

- [ ] **Step 1: Write the failing component tests**

Create `src/components/ScorePillBar.test.tsx` with tests that:

- render a score pill with score `4`
- assert the pill uses the `score-mid` class
- assert the button `title` is `3-4: developing / capable`

Extend `src/components/TraitCard.test.tsx` with tests that:

- score `4` applies `.score-mid`
- the score text element has `title="3-4: developing / capable"`

Add one focused test for the active score in `src/pages/EssayPage.tsx` only if it is easy to render with the existing test harness. If not, cover that path by manual QA in Task 4.

- [ ] **Step 2: Run the score component tests to verify they fail**

Run: `npm test -- src/components/ScorePillBar.test.tsx src/components/TraitCard.test.tsx`

Expected:
- FAIL because `ScorePillBar` still uses `traitData.feedback` for `title`
- FAIL because `TraitCard` has no tooltip title
- FAIL because score `4` is still treated as high by shared helpers before Task 1 is merged, or pass after Task 1 and fail only on tooltip wiring

- [ ] **Step 3: Implement the minimal score surface changes**

In `src/components/ScorePillBar.tsx`:

- import `scoreTooltip`
- change `title={traitData.feedback}` to `title={scoreTooltip(score)}`

In `src/components/TraitCard.tsx`:

- import `scoreTooltip`
- add `title={scoreTooltip(evaluation.score)}` to the score span

In `src/pages/EssayPage.tsx`:

- import `scoreTooltip`
- add the same `title` to the active score span in the trait popover

Do not change visible labels or layout.

- [ ] **Step 4: Run the score component tests to verify they pass**

Run: `npm test -- src/components/ScorePillBar.test.tsx src/components/TraitCard.test.tsx`

Expected:
- PASS

- [ ] **Step 5: Commit**

```bash
git add src/components/ScorePillBar.tsx src/components/TraitCard.tsx src/pages/EssayPage.tsx src/components/ScorePillBar.test.tsx src/components/TraitCard.test.tsx
git commit -m "feat: add consistent score tooltips"
```

---

### Task 3: Align Transition And Sidebar Status Colors

**Files:**
- Modify: `src/index.css`
- Modify: `src/components/CoachDrawer.tsx`
- Create: `src/components/CoachDrawer.test.tsx`
- Modify: `src/components/TransitionView.test.tsx`

- [ ] **Step 1: Write the failing status-color tests**

In `src/components/CoachDrawer.test.tsx`, add focused tests for report counts:

- `count === 0` renders `coach-sb-count-clear`
- `count === 1` renders `coach-sb-count-few`
- `count === 3` renders `coach-sb-count-issues`

These tests should use the smallest possible fake props and assert class names only.

In `src/components/TransitionView.test.tsx`, add a focused test that an `adequate` transition still renders with the `adequate` class in the UI. The CSS color itself will be verified by targeted manual QA since jsdom does not validate authored CSS values.

- [ ] **Step 2: Run the status-color test files to verify they fail where expected**

Run: `npm test -- src/components/CoachDrawer.test.tsx src/components/TransitionView.test.tsx`

Expected:
- FAIL because `CoachDrawer.test.tsx` does not exist yet
- PASS or FAIL for `TransitionView` depending on the exact added assertion, but the new test file must exist before implementation

- [ ] **Step 3: Implement the minimal non-score alignment**

In `src/index.css`:

- keep grammar and prompt colors unchanged
- change transition `adequate` from neutral gray to `var(--color-yellow)` in:
  - `.transition-bar-segment.adequate`
  - `.legend-dot.adequate`
  - `.transition-dot.adequate`
  - `.transition-marker.adequate .transition-marker-line`
  - `.transition-marker.adequate .transition-marker-quality`

- change sidebar count colors so:
  - `.coach-sb-count-clear` stays green
  - `.coach-sb-count-few` becomes amber
  - `.coach-sb-count-issues` becomes red

In `src/components/CoachDrawer.tsx`:

- keep structure unchanged
- keep the current thresholds unless product review says otherwise:
  - `0 => clear`
  - `1-2 => few`
  - `>2 => issues`

This task is semantic alignment only, not threshold redesign.

- [ ] **Step 4: Run the status-color test files to verify they pass**

Run: `npm test -- src/components/CoachDrawer.test.tsx src/components/TransitionView.test.tsx`

Expected:
- PASS

- [ ] **Step 5: Run the broader affected test set**

Run: `npm test -- src/utils.test.ts src/components/ScorePillBar.test.tsx src/components/TraitCard.test.tsx src/components/TransitionView.test.tsx src/components/GrammarView.test.tsx src/components/CoachDrawer.test.tsx`

Expected:
- PASS

- [ ] **Step 6: Manual QA in the browser**

Run: `npm run dev`

Verify:

- score pills show `4` as amber
- trait cards show `4` as amber
- active score text shows `4` as amber
- score tooltips appear on hover/focus
- transitions `adequate` now visually match the amber "needs work" bucket
- grammar remains red / amber / green
- prompt remains red / amber / green
- sidebar counts now read green / amber / red without layout changes

- [ ] **Step 7: Commit**

```bash
git add src/index.css src/components/CoachDrawer.tsx src/components/CoachDrawer.test.tsx src/components/TransitionView.test.tsx
git commit -m "feat: align report status colors"
```

---

### Task 4: Final Verification

**Files:**
- Modify: none expected

- [ ] **Step 1: Run the full test suite**

Run: `npm test`

Expected:
- PASS

- [ ] **Step 2: Run a production build**

Run: `npm run build`

Expected:
- PASS

- [ ] **Step 3: Review git diff for scope**

Run: `git diff --stat HEAD~3..HEAD`

Expected:
- only score helpers, tooltips, transition CSS, sidebar count colors, and tests

- [ ] **Step 4: Commit any final cleanup if needed**

```bash
git add -A
git commit -m "chore: finalize color semantics alignment"
```

