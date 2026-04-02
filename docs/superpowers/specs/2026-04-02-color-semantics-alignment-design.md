# Reduced Color Semantics Alignment Design

## Goal

Pause the broader reporting redesign and ship a smaller pass that makes color meaning consistent across the existing UI.

The app should use one semantic ladder everywhere:

- Green = strong / clear
- Amber = developing / needs work
- Red = problem / fix

This applies to report problem states, sidebar report counts, trait cards, score pills, and active score text.

## Scope

In scope:

- Align score coloring to the same semantic ladder used by report states
- Align transition colors with grammar and prompt colors
- Align sidebar report count badge colors with the same semantics
- Add lightweight tooltip text to score surfaces so the stricter score colors remain understandable

Out of scope:

- Findings buckets
- Readiness stages
- Prompt or rubric recalibration
- Layout changes
- New visible labels
- Copy changes beyond short score tooltips

## Approved Direction

Use strict visual unification.

Trait scores will use:

- 1-2 = red
- 3-4 = amber
- 5-6 = green

Tooltips on score surfaces will clarify that a 4 is still "capable" even though it is amber.

## Current Inconsistencies

The current UI mixes incompatible meanings:

- Scores use `1-2 red / 3 amber / 4-6 green`
- Grammar already uses `error red / warning amber / clean green`
- Prompt already uses `empty red / partial amber / filled green`
- Transitions use `smooth green / adequate neutral gray / weak amber / missing red`
- Sidebar report counts use green for clear, muted gray for low concern, and accent amber for higher issue counts

This makes color unreliable as a mental model.

## Implementation Design

### 1. Score Semantics

Update score helpers in `src/utils.ts` so all score-driven UI uses:

- `score <= 2` => low / red
- `score <= 4` => mid / amber
- `score >= 5` => high / green

This change should flow automatically to:

- `src/components/ScorePillBar.tsx`
- `src/components/TraitCard.tsx`
- `src/pages/EssayPage.tsx`

### 2. Transition Semantics

Keep the existing four transition states, but tighten their color mapping:

- smooth = green
- adequate = amber
- weak = amber
- missing = red

This preserves the current structure while removing the neutral gray exception.

### 3. Sidebar Count Semantics

Keep the current report list and count badges exactly as-is structurally.

Only adjust the badge color meaning:

- zero issues = green
- low but nonzero concern = amber
- high concern = red

The report list remains navigation, not a redesigned summary.

### 4. Score Tooltips

Add `title` text to score surfaces:

- score pills
- trait score values
- active score text

Tooltip copy should stay short and rubric-aligned:

- `1-2: major problems`
- `3-4: developing / capable`
- `5-6: strong / clear`

This is the only copy addition in the reduced pass.

## Files In Scope

- `src/utils.ts`
- `src/index.css`
- `src/components/ScorePillBar.tsx`
- `src/components/TraitCard.tsx`
- `src/pages/EssayPage.tsx`
- `src/components/CoachDrawer.tsx`

## Testing Strategy

### Unit Tests

Add or expand tests for:

- `scoreLevel()` mapping `4` to mid instead of high
- `scoreColor()` mapping `4` to amber instead of green
- tooltip text rendering on score pill and trait score surfaces where practical

### UI Regression Checks

Verify in the running app that:

- Grammar remains red / amber / green
- Prompt remains red / amber / green
- Transition "adequate" now renders amber
- Sidebar counts now read as green / amber / red
- Score pills and trait scores show amber for 3 and 4
- 5 and 6 remain green

## Risks

### Perception Risk

The main risk is that score 4 may feel harsher because it is no longer green.

Mitigation:

- keep the structure unchanged
- add score tooltips
- avoid adding any new warning copy or layout emphasis

### Scope Creep Risk

This work can easily slide back into the broader reporting redesign.

Mitigation:

- no new sections
- no new data structures
- no prompt changes
- no recalibration work in this pass

## Visual Reference

Approved reduced mockup was reviewed through the local visual companion on 2026-04-02. It showed:

- same layout
- same report list
- same score pills
- only semantic color tightening

## Success Criteria

This pass is successful if a user can look across the app and infer one consistent rule:

- green means strong / clear
- amber means developing / needs work
- red means problem / fix

without the app changing structure or introducing the larger redesign.
