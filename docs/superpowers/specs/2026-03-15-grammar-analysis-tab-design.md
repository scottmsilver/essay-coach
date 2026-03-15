# Grammar Analysis Tab — Design Spec

**Date:** 2026-03-15
**Status:** Draft

## Overview

Add a "Grammar" tab to the essay evaluation UI, alongside the existing Feedback and Transitions tabs. The Grammar tab provides a comprehensive grammar analysis covering both sentence-level mechanics (errors) and higher-order writing patterns, with categorized counts and inline Socratic feedback that identifies errors and guides students toward fixes.

## Architecture

Follows the exact same pattern as the Transitions tab:

### Backend

| File | Purpose |
|---|---|
| `functions/src/grammar.ts` | System prompt, JSON schema, prompt builder, Gemini call |
| `functions/src/analyzeGrammar.ts` | Firebase cloud function (auth, Firestore read/write, calls grammar.ts) |
| `functions/src/index.ts` | Export new cloud function |

### Frontend

| File | Purpose |
|---|---|
| `src/components/GrammarView.tsx` | React component — summary bar, category breakdown, essay with inline markers |
| `src/types.ts` | Add `GrammarIssue`, `GrammarAnalysis` interfaces + extend `Draft` |
| `src/pages/EssayPage.tsx` | Add third tab, wire up `analyzeGrammar` call on tab click |
| `src/index.css` | Styles for grammar underlines, category list, severity colors |

### Firestore

Two new fields on the draft document:

```
drafts/{draftId}.grammarAnalysis   — cached GrammarAnalysis result
drafts/{draftId}.grammarStatus     — progress indicator (reuses EvaluationStatus type)
```

### Data Flow

1. User clicks "Grammar" tab (lazy — no analysis on initial submission)
2. Frontend checks: if `grammarAnalysis` already exists, render it; if `grammarStatus` is in-progress, show spinner; otherwise call `analyzeGrammar` cloud function
3. Cloud function reads essay content from draft, sends to Gemini with grammar-specific system prompt + structured schema
4. Gemini returns structured JSON → saved to `draft.grammarAnalysis`
5. Frontend renders `GrammarView` with summary bar + category breakdown + inline markers
6. Subsequent visits read from cache — no re-analysis

Grammar analysis can run in parallel with transitions or evaluation — no shared state.

## Grammar Categories

### Severity Levels

| Severity | Meaning | Color |
|---|---|---|
| `error` | Definitively wrong | Red |
| `warning` | Likely wrong, context-dependent | Yellow |
| `pattern` | Stylistic observation, not wrong | Blue (dashed) |

### Tier 1: Sentence-Level Mechanics

| Category | Default Severity | What It Catches |
|---|---|---|
| Comma splices | error | Two independent clauses joined by just a comma |
| Run-on sentences | error | Fused sentences, excessive conjunction chaining |
| Fragments | error | Dependent clauses or phrases posing as sentences |
| Subject-verb agreement | error | "The number of students are..." |
| Pronoun reference | warning | Vague "this/they", ambiguous antecedents |
| Verb tense consistency | warning | Unmotivated tense shifts between adjacent sentences |
| Parallel structure | error | Inconsistent grammatical forms in lists/series |
| Punctuation errors | error | Semicolons, apostrophes, colons used incorrectly |
| Missing commas | error | Before coordinating conjunctions, after introductory clauses, around non-restrictives |

### Tier 2: Higher-Order Patterns

| Category | What It Analyzes |
|---|---|
| Sentence variety | Length distribution + structure types (simple/compound/complex/compound-complex) |
| Active vs. passive voice | Ratio + flags each passive instance with Socratic guidance |
| Modifier placement | Dangling/misplaced modifiers |
| Wordiness | Redundant phrasing, throat-clearing, inflated expressions |

## Schema

The TypeScript interfaces below match the Gemini `responseSchema` structure validated in `functions/scripts/test-grammar.ts`. The Gemini schema object (`GRAMMAR_ANALYSIS_SCHEMA`) should be adapted directly from that test script.

### TypeScript Interfaces

```typescript
// Individual issue found in the essay
interface GrammarIssue {
  sentence: string;              // sentence context for disambiguation
  quotedText: string;            // exact text from essay
  comment: string;               // Socratic guidance identifying the error
  severity: 'error' | 'warning' | 'pattern';
}

// Wrapper for each mechanics category
interface GrammarIssueCategory {
  locations: GrammarIssue[];
}

// Full analysis response from Gemini
interface GrammarAnalysis {
  // Tier 1: Sentence-level mechanics
  commaSplices: GrammarIssueCategory;
  runOnSentences: GrammarIssueCategory;
  fragments: GrammarIssueCategory;
  subjectVerbAgreement: GrammarIssueCategory;
  pronounReference: GrammarIssueCategory;
  verbTenseConsistency: GrammarIssueCategory;
  parallelStructure: GrammarIssueCategory;
  punctuationErrors: GrammarIssueCategory;
  missingCommas: GrammarIssueCategory;

  // Tier 2: Higher-order patterns
  sentenceVariety: {
    avgLength: number;
    distribution: {
      simple: number;
      compound: number;
      complex: number;
      compoundComplex: number;
    };
    comment: string;
  };
  activePassiveVoice: {
    activeCount: number;          // preserved for ratio display
    passiveCount: number;
    passiveInstances: {
      quotedText: string;
      comment: string;
    }[];
  };
  modifierPlacement: {
    issues: { quotedText: string; comment: string }[];
  };
  wordiness: {
    instances: { quotedText: string; comment: string }[];
  };

  // Summary
  summary: {
    totalErrors: number;          // count of error + warning severity items
    errorsByCategory: {
      commaSplices: number;
      runOnSentences: number;
      fragments: number;
      subjectVerbAgreement: number;
      pronounReference: number;
      verbTenseConsistency: number;
      parallelStructure: number;
      punctuationErrors: number;
      missingCommas: number;
    };
    overallComment: string;       // 2-3 sentence overview
    strengthAreas: string[];      // what's working
    priorityFixes: string[];      // top 3 things to fix first
  };
}
```

### Draft Interface Update

Add to the existing `Draft` interface in `src/types.ts`:

```typescript
interface Draft {
  // ...existing fields...
  grammarAnalysis?: GrammarAnalysis | null;
  grammarStatus?: EvaluationStatus | null;  // reuses existing type
}
```

### Gemini responseSchema

Adapt `GRAMMAR_ANALYSIS_SCHEMA` directly from `functions/scripts/test-grammar.ts` (lines 97-207). This schema has been validated against Gemini with 90% detection accuracy and zero false positives. Do not restructure — it is the canonical schema.

### quotedText Disambiguation

The `sentence` field on `GrammarIssue` provides context for locating short `quotedText` values (e.g., a single word like "are") within the essay. The frontend should:
1. Search for `quotedText` within the essay text
2. If multiple matches exist, use `sentence` to disambiguate by finding which match falls within the sentence context
3. If still ambiguous, highlight the first unmatched occurrence

## System Prompt

The full system prompt is in `functions/scripts/test-grammar.ts` (lines 211-251, `GRAMMAR_SYSTEM_PROMPT`). Use it as the starting point for `grammar.ts`, with these additions:

- **Cross-sentence tense checking**: Add explicit instruction to check for tense shifts between adjacent sentences, not just within them (the one weakness identified in testing)
- **Grade-level calibration**: Don't flag sophisticated constructions as errors (intentional fragments for rhetorical effect, correctly used semicolons)

Key principles already in the tested prompt:
- Identify errors explicitly, then ask a Socratic guiding question
- Quote exact text from the essay
- Never rewrite the student's text
- Only flag genuine issues — do not invent errors

### Essay Formatting

The test script sends raw essay text (not the `¶1 S1:` numbered format used by transitions). The numbered format is unnecessary here because grammar issues reference `quotedText` spans, not sentence indices. Keep raw text to avoid confusing Gemini with formatting artifacts.

## Frontend: GrammarView Component

### Layout

**Summary Bar (top)**
- Proportional bar with red/yellow/blue segments for error/warning/pattern counts
- Counts derived from array lengths (e.g., `commaSplices.locations.length`), not from `summary.errorsByCategory`
- Legend: "5 errors, 3 warnings, 4 patterns"
- Active/passive ratio displayed: "12 active, 3 passive (20% passive)"
- `summary.overallComment` text below the bar

**Category Breakdown (below summary)**
- Collapsible list grouped by tier (Mechanics / Patterns)
- Each category shows name + count badge, e.g. `Comma Splices (2)`
- Categories with 0 issues are hidden (not dimmed — reduces visual noise)
- Clicking a category filters the essay to show only those issues
- `strengthAreas` shown as green callout card
- `priorityFixes` shown as numbered list callout card

**Essay with Inline Markers (main area)**
- Issues rendered as colored underlines on the `quotedText` span
  - Red wavy underline = error
  - Yellow wavy underline = warning
  - Blue dashed underline = pattern
- Click underline → comment pops up below (same interaction as transition dots)
- When a category is selected in the breakdown, only matching underlines are visible
- Default view: show errors + warnings, hide patterns (toggle to show all)

### Empty State

When the essay has zero grammar issues across all categories:
- Summary bar shows solid green with "0 errors, 0 warnings"
- `summary.overallComment` provides the congratulatory text (Gemini generates this)
- `strengthAreas` still displayed
- No category breakdown shown (all categories would be empty)

### Key Difference from TransitionView

Transitions places markers *between* sentences (dots/bars). Grammar places markers *on* text spans within sentences (underlines). This is closer to the AnnotatedEssay component's positioning but with the category/count chrome from TransitionView.

## Tab Integration

`EssayPage.tsx` activeView state expands:

```typescript
const [activeView, setActiveView] = useState<'feedback' | 'transitions' | 'grammar'>('feedback');
```

Third tab button added to `.view-toggle` container.

### Triggering

Analysis triggers on first Grammar tab click. Before calling the cloud function, check:
1. If `grammarAnalysis` is already populated → render it (no API call)
2. If `grammarStatus?.stage === 'thinking' || 'generating'` → show spinner (analysis in progress, don't fire duplicate call)
3. Otherwise → call `analyzeGrammar` cloud function

### Draft Switching

When the user switches drafts via `DraftSelector`, the grammar analysis state should reflect the new draft's `grammarAnalysis` field. If the user is on the Grammar tab and switches to a draft that has no grammar analysis, show the "click to analyze" state rather than auto-triggering.

## Testing

A test script exists at `functions/scripts/test-grammar.ts` from the feasibility test. Results:
- 90% detection rate on deliberately planted errors (9/10 found)
- 0 false positives
- ~62s per essay with thinking enabled
- Both sentence-level mechanics and higher-order patterns handled in one call
- Socratic guidance quality is excellent — identifies errors explicitly and asks guiding questions

The one weakness: cross-sentence tense shifts were not reliably detected. Addressed via system prompt enhancement (see System Prompt section).

## Scope

### In scope
- Backend: grammar.ts, analyzeGrammar.ts, index.ts export
- Frontend: GrammarView.tsx, types, EssayPage tab, CSS
- Single Gemini pass covering all categories (validated by testing)

### Out of scope
- No changes to existing evaluation or transitions systems
- No grammar scoring (Conventions trait already covers scoring)
- No resubmission comparison ("You fixed 3 of 5 comma splices") — future enhancement
- No grammar analysis in the CLI test harness beyond the existing test script
- No extraction of shared Gemini streaming utility (tech debt noted but not blocking)

## Implementation Sequence

1. `functions/src/grammar.ts` — system prompt (from test-grammar.ts + enhancements), Gemini schema (from test-grammar.ts), prompt builder, `analyzeGrammarWithGemini()` function
2. `functions/src/analyzeGrammar.ts` — cloud function (copy-adapt from analyzeTransitions.ts)
3. `functions/src/index.ts` — export new function
4. `src/types.ts` — add `GrammarIssue`, `GrammarIssueCategory`, `GrammarAnalysis` interfaces; extend `Draft` with `grammarAnalysis` and `grammarStatus` fields
5. `src/components/GrammarView.tsx` — summary bar, category breakdown, essay with underlined issue markers
6. `src/pages/EssayPage.tsx` — third tab button, wire up `analyzeGrammar` call with concurrency guard, handle draft switching
7. `src/index.css` — grammar-specific styles (underlines, severity colors, category list)

## Performance

- Single Gemini call: ~62s (same as existing evaluation)
- Cost: ~$0.03 per analysis
- Cached on draft — subsequent visits are free
- Can run in parallel with transitions analysis
- Firebase Functions cold start may add 5-10s on first call; acceptable given the existing transitions behavior sets the same expectation
