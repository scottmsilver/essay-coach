# GDoc Suggestions-Accepted Import — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Import a Google Doc's text as if all tracked-changes suggestions were accepted, with a per-import toggle (Original vs Suggestions accepted), validated against the full production doc corpus before cutover.

**Architecture:** The Apps Script web app switches its text extraction from `DocumentApp` body-walking to a pure JSON→text builder over the Docs advanced service (`Docs.Documents.get` with `suggestionsViewMode`). Bookmarks are NOT exposed by the Docs REST API, so bookmark positions still come from `DocumentApp` and are mapped into the projected text via an element-index mapping computed from the `DEFAULT_FOR_CURRENT_ACCESS` JSON. The builder is a standalone JS file shared verbatim between the deployed script string and vitest unit tests. A corpus harness fetches every doc referenced in Firestore through both the old and new deployments and requires byte-identical base-mode output before cutover.

**Tech Stack:** Apps Script (V8) + Docs advanced service v1, TypeScript, React + Mantine, vitest, firebase-admin (harness).

## Global Constraints

- FORMAT CONTRACT (from `functions/scripts/apps-script-source.ts` header, must stay in sync with `src/utils/pasteHandler.ts`): indented paragraphs → `\t` prefix; bullet list items → `•` (`• `) prefix; numbered list items → `N. ` prefix; paragraph separation → `\n\n`; consecutive list items → `\n`.
- `DocSource.suggestionMode` is optional; `undefined` means `'base'`. Never write `suggestionMode: undefined` to Firestore (omit the key instead).
- Default UI mode when a doc has suggestions: `'accepted'`. Toggle hidden when `hasSuggestions` is false.
- **DO NOT COMMIT OR PUSH.** Project rule: commits require the user's explicit go-ahead. Leave all work uncommitted in the working tree. Skip every "Commit" step; run the verification steps only.
- The Google Doc is never mutated.
- No hardcoded server URLs (existing `WEBAPP_BASE` + deployment-id env pattern).

## Empirical checkpoints (cannot be resolved offline)

1. **What `DocumentApp.getText()` returns for a doc with pending suggestions** (base-only vs insertions-included) is undocumented. Task 6 creates a fixture doc with suggestions and compares old-deployment output against the new deployment's `base` and `accepted` outputs. If old == accepted-ish, the equivalence harness comparisons and `IN_BASE`/`IN_ACCEPTED` flag definitions in the builder must be revisited (one-line change in `elementVisibility`, documented there).
2. Whether `DocumentApp` bookmark child indices align with the DEFAULT-JSON element walk (they should: one structural element per paragraph/list-item/table, `sectionBreak` excluded). Verified by the corpus harness on every real doc that has bookmarks.

---

### Task 1: Shared types + fetch param

**Files:**
- Modify: `shared/gdocTypes.ts`
- Modify: `src/utils/gdocImport.ts`
- Test: `src/utils/gdocImport.test.ts` (create)

**Interfaces:**
- Produces: `type SuggestionMode = 'base' | 'accepted'`; `DocSource.suggestionMode?: SuggestionMode`; `GDocWebAppResponse.hasSuggestions?: boolean`; `fetchGDocInfo(docId: string, tab?: string | null, suggestions?: SuggestionMode): Promise<GDocWebAppResponse>`.

- [ ] **Step 1: Write the failing test** (`src/utils/gdocImport.test.ts`)

```ts
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { fetchGDocInfo } from './gdocImport';

describe('fetchGDocInfo', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_GDOC_WEBAPP_DEPLOYMENT_ID', 'DEPLOY123');
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200,
      json: async () => ({ tabTitle: 'T', tabId: 't.0', textLength: 0, text: '', bookmarks: [], tabs: [] }),
    })));
  });
  afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

  it('omits suggestions param by default', async () => {
    await fetchGDocInfo('DOC1');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('docId=DOC1');
    expect(url).not.toContain('suggestions=');
  });

  it('passes suggestions=accepted when requested', async () => {
    await fetchGDocInfo('DOC1', null, 'accepted');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('suggestions=accepted');
  });

  it('passes suggestions=base explicitly when given', async () => {
    await fetchGDocInfo('DOC1', 'Tab 1', 'base');
    const url = (fetch as ReturnType<typeof vi.fn>).mock.calls[0][0] as string;
    expect(url).toContain('suggestions=base');
    expect(url).toContain('tab=Tab+1');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/utils/gdocImport.test.ts`
Expected: FAIL (fetchGDocInfo takes 2 args; `suggestions=` assertions fail).

- [ ] **Step 3: Implement.** In `shared/gdocTypes.ts` add after the imports/top:

```ts
/** How suggestions (tracked changes) are projected when reading a doc. */
export type SuggestionMode = 'base' | 'accepted';
```

Extend `DocSource`:

```ts
export interface DocSource {
  docId: string;
  tab: string;
  sectionIndex: number;
  /** Human-readable doc title at pick time. Shown in UI so the user knows which doc. */
  docName?: string;
  /** How the doc text was projected at import. undefined = 'base'
   *  (backward compatible with all existing essays). */
  suggestionMode?: SuggestionMode;
}
```

Extend `GDocWebAppResponse` with:

```ts
  /** True when the doc contains pending suggested edits. Optional because
   *  older script deployments don't return it. */
  hasSuggestions?: boolean;
```

In `src/utils/gdocImport.ts` change `fetchGDocInfo`:

```ts
import type { GDocWebAppResponse, SuggestionMode } from '../../shared/gdocTypes';

export async function fetchGDocInfo(
  docId: string,
  tab?: string | null,
  suggestions?: SuggestionMode,
): Promise<GDocWebAppResponse> {
  const deploymentId = getDeploymentId();
  const params = new URLSearchParams({ docId });
  if (tab) params.set('tab', tab);
  if (suggestions) params.set('suggestions', suggestions);
  const url = `${WEBAPP_BASE}/${deploymentId}/exec?${params}`;
  // ...rest unchanged
```

- [ ] **Step 4: Run tests + typecheck**

Run: `npx vitest run src/utils/gdocImport.test.ts && npx tsc --noEmit`
Expected: PASS, clean typecheck.

---

### Task 2: JSON→text builder (pure JS, shared with deployed script)

**Files:**
- Create: `functions/scripts/gdoc-text-builder.js`
- Test: `functions/scripts/gdoc-text-builder.test.ts` (Task 3)

**Interfaces:**
- Produces (all attached to `var GDocBuilder = {...}` so the same file body runs inside Apps Script and under Node import):
  - `projectTab(body, lists) -> { text: string, childMeta: Array<{startOffset:number, prefixLen:number, textLen:number}> }` — body = `documentTab.body` from Docs JSON in ANY suggestionsViewMode; lists = `documentTab.lists`.
  - `elementVisibility(defaultBody) -> Array<{inBase:boolean, inAccepted:boolean}>` — one entry per structural element (paragraph/table, sectionBreak excluded) of a `DEFAULT_FOR_CURRENT_ACCESS` body.
  - `mapIndex(vis, baseIdx, mode) -> number` — maps a base-projection element index to the given mode's element index (next surviving element if deleted; clamped to last).
  - `hasSuggestions(defaultBody) -> boolean`.

The file must be valid Apps Script V8 code (no `export`/`require` in the body). Node interop via a trailing guarded block.

- [ ] **Step 1: Write the file** (`functions/scripts/gdoc-text-builder.js`):

```js
/**
 * Pure JSON→text builder over Docs API document JSON.
 * Runs BOTH inside Apps Script (embedded verbatim into APPS_SCRIPT_CODE)
 * and under Node/vitest (via the module.exports guard at the bottom).
 *
 * FORMAT CONTRACT (must stay in sync with src/utils/pasteHandler.ts):
 *   - Indented paragraphs → \t prefix
 *   - Bullet list items → • (•) prefix
 *   - Numbered list items → N. prefix
 *   - Paragraph separation → \n\n
 *   - Consecutive list items → \n
 */
var GDocBuilder = (function () {
  var NUMBERED_GLYPHS = {
    DECIMAL: true, ZERO_DECIMAL: true,
    ALPHA: true, UPPER_ALPHA: true,
    ROMAN: true, UPPER_ROMAN: true,
  };

  /** Structural elements that count as body children (mirror DocumentApp). */
  function bodyElements(body) {
    var out = [];
    var content = (body && body.content) || [];
    for (var i = 0; i < content.length; i++) {
      if (content[i].paragraph || content[i].table) out.push(content[i]);
    }
    return out;
  }

  function paragraphText(p) {
    var s = '';
    var els = p.elements || [];
    for (var i = 0; i < els.length; i++) {
      if (els[i].textRun && typeof els[i].textRun.content === 'string') {
        s += els[i].textRun.content;
      }
    }
    // Docs JSON terminates every paragraph with \n; DocumentApp getText() does not.
    return s.replace(/\n$/, '');
  }

  function isNumbered(p, lists) {
    var b = p.bullet;
    if (!b || !lists) return false;
    var list = lists[b.listId];
    if (!list || !list.listProperties || !list.listProperties.nestingLevels) return false;
    var lvl = list.listProperties.nestingLevels[b.nestingLevel || 0];
    return !!(lvl && NUMBERED_GLYPHS[lvl.glyphType]);
  }

  function projectTab(body, lists) {
    var elements = bodyElements(body);
    var childMeta = [];
    var chunks = [];
    var pos = 0;
    var listCounters = {};

    for (var i = 0; i < elements.length; i++) {
      var se = elements[i];
      var ctext = '';
      var prefix = '';
      var isListItem = false;

      if (se.paragraph) {
        var p = se.paragraph;
        ctext = paragraphText(p);
        if (p.bullet) {
          isListItem = true;
          if (isNumbered(p, lists)) {
            var listId = p.bullet.listId;
            if (!listCounters[listId]) listCounters[listId] = 0;
            listCounters[listId]++;
            prefix = listCounters[listId] + '. ';
          } else {
            prefix = '• ';
          }
        } else {
          listCounters = {};
          var ps = p.paragraphStyle;
          var indent = ps && ps.indentFirstLine && ps.indentFirstLine.magnitude;
          if (ctext.length > 0 && indent > 0) prefix = '\t';
        }
      }
      // tables: ctext stays '' (matches current DocumentApp script, which only
      // extracts PARAGRAPH and LIST_ITEM text but still counts the child).

      childMeta.push({ startOffset: pos, prefixLen: prefix.length, textLen: ctext.length });
      chunks.push(prefix + ctext);
      pos += prefix.length + ctext.length;

      if (i < elements.length - 1) {
        var next = elements[i + 1];
        var nextIsList = !!(next.paragraph && next.paragraph.bullet);
        if (isListItem && nextIsList) {
          pos += 1; // single \n from join
        } else {
          chunks.push(''); // forces \n\n through join
          pos += 2;
        }
      }
    }

    return { text: chunks.join('\n'), childMeta: childMeta };
  }

  /** True when any structural element carries pending suggestion markers.
   *  Only meaningful on DEFAULT_FOR_CURRENT_ACCESS JSON (preview modes strip markers). */
  function hasSuggestions(defaultBody) {
    var content = (defaultBody && defaultBody.content) || [];
    var json = JSON.stringify(content);
    return json.indexOf('"suggestedInsertionIds"') !== -1 ||
           json.indexOf('"suggestedDeletionIds"') !== -1;
  }

  /** Per-element visibility in each projection, from DEFAULT_FOR_CURRENT_ACCESS JSON.
   *  An element is:
   *   - absent from BASE if every text run in it is a suggested insertion
   *   - absent from ACCEPTED if every text run in it is a suggested deletion
   *  EMPIRICAL CHECKPOINT: if the corpus/fixture comparison (plan Task 6) shows
   *  DocumentApp includes suggested insertions, flip inBase to `true` always. */
  function elementVisibility(defaultBody) {
    var elements = bodyElements(defaultBody);
    var out = [];
    for (var i = 0; i < elements.length; i++) {
      var p = elements[i].paragraph;
      if (!p) { out.push({ inBase: true, inAccepted: true }); continue; }
      var els = p.elements || [];
      var sawRun = false, allInserted = true, allDeleted = true;
      for (var j = 0; j < els.length; j++) {
        var tr = els[j].textRun;
        if (!tr) continue;
        // the trailing "\n"-only run counts like its paragraph
        sawRun = true;
        if (!(tr.suggestedInsertionIds && tr.suggestedInsertionIds.length)) allInserted = false;
        if (!(tr.suggestedDeletionIds && tr.suggestedDeletionIds.length)) allDeleted = false;
      }
      out.push({
        inBase: !sawRun || !allInserted,
        inAccepted: !sawRun || !allDeleted,
      });
    }
    return out;
  }

  /** Map a base-projection element index to the target mode's element index. */
  function mapIndex(vis, baseIdx, mode) {
    if (mode !== 'accepted') return baseIdx;
    // Walk DEFAULT elements; count base-visible until we hit baseIdx,
    // tracking the accepted-visible index as we go.
    var b = -1, a = -1, lastA = 0;
    for (var i = 0; i < vis.length; i++) {
      if (vis[i].inAccepted) { a++; lastA = a; }
      if (vis[i].inBase) {
        b++;
        if (b === baseIdx) return vis[i].inAccepted ? a : Math.max(0, lastA);
      }
    }
    return Math.max(0, lastA);
  }

  return {
    projectTab: projectTab,
    hasSuggestions: hasSuggestions,
    elementVisibility: elementVisibility,
    mapIndex: mapIndex,
    bodyElements: bodyElements,
  };
})();

/* Node/vitest interop — inert inside Apps Script. */
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GDocBuilder;
}
```

- [ ] **Step 2: Verify it parses under Node**

Run: `node -e "const b=require('./functions/scripts/gdoc-text-builder.js'); console.log(typeof b.projectTab)"`
Expected: `function`

---

### Task 3: Builder unit tests (fixtures)

**Files:**
- Create: `functions/scripts/gdoc-text-builder.test.ts`

**Interfaces:**
- Consumes: `GDocBuilder` from Task 2 (`projectTab`, `hasSuggestions`, `elementVisibility`, `mapIndex`).

Fixture helpers keep the JSON terse. Every paragraph in Docs JSON ends with a `\n` run — helpers append it.

- [ ] **Step 1: Write the tests**

```ts
import { describe, it, expect } from 'vitest';
// eslint-disable-next-line @typescript-eslint/no-require-imports
const GDocBuilder = require('./gdoc-text-builder.js');

type Run = { content: string; ins?: boolean; del?: boolean };

function para(runs: Run[], opts: { indent?: number; bullet?: { listId: string; nestingLevel?: number } } = {}) {
  return {
    paragraph: {
      elements: runs.map(r => ({
        textRun: {
          content: r.content,
          ...(r.ins ? { suggestedInsertionIds: ['s1'] } : {}),
          ...(r.del ? { suggestedDeletionIds: ['s2'] } : {}),
        },
      })),
      ...(opts.indent ? { paragraphStyle: { indentFirstLine: { magnitude: opts.indent, unit: 'PT' } } } : {}),
      ...(opts.bullet ? { bullet: opts.bullet } : {}),
    },
  };
}
const P = (text: string, opts: Parameters<typeof para>[1] = {}) => para([{ content: text + '\n' }], opts);
const body = (...content: unknown[]) => ({ content: [{ sectionBreak: {} }, ...content] });

const NUMBERED_LISTS = { L1: { listProperties: { nestingLevels: [{ glyphType: 'DECIMAL' }] } } };
const BULLET_LISTS = { L2: { listProperties: { nestingLevels: [{ glyphType: 'GLYPH_TYPE_UNSPECIFIED', glyphSymbol: '●' }] } } };

describe('projectTab — FORMAT CONTRACT', () => {
  it('joins plain paragraphs with \\n\\n and skips the sectionBreak', () => {
    const { text } = GDocBuilder.projectTab(body(P('One.'), P('Two.')), {});
    expect(text).toBe('One.\n\nTwo.');
  });

  it('prefixes first-line-indented paragraphs with \\t', () => {
    const { text } = GDocBuilder.projectTab(body(P('Indented.', { indent: 36 })), {});
    expect(text).toBe('\tIndented.');
  });

  it('does not indent-prefix empty paragraphs', () => {
    const { text } = GDocBuilder.projectTab(body(para([{ content: '\n' }], { indent: 36 }), P('X')), {});
    expect(text).toBe('\n\nX');
  });

  it('renders bullets with • and single \\n between consecutive items', () => {
    const { text } = GDocBuilder.projectTab(
      body(P('a', { bullet: { listId: 'L2' } }), P('b', { bullet: { listId: 'L2' } }), P('after')),
      BULLET_LISTS,
    );
    expect(text).toBe('• a\n• b\n\nafter');
  });

  it('numbers DECIMAL list items per list and resets counters after a paragraph', () => {
    const { text } = GDocBuilder.projectTab(
      body(
        P('one', { bullet: { listId: 'L1' } }),
        P('two', { bullet: { listId: 'L1' } }),
        P('break'),
        P('one again', { bullet: { listId: 'L1' } }),
      ),
      NUMBERED_LISTS,
    );
    expect(text).toBe('1. one\n2. two\n\nbreak\n\n1. one again');
  });

  it('childMeta startOffsets index into the built text', () => {
    const { text, childMeta } = GDocBuilder.projectTab(body(P('One.'), P('Two.', { indent: 18 })), {});
    expect(text.substring(childMeta[1].startOffset)).toBe('\tTwo.');
    expect(childMeta[1].prefixLen).toBe(1);
  });

  it('tables contribute an empty chunk but still occupy a child slot', () => {
    const { text, childMeta } = GDocBuilder.projectTab(body(P('a'), { table: {} }, P('b')), {});
    expect(text).toBe('a\n\n\n\nb');
    expect(childMeta.length).toBe(3);
  });
});

describe('suggestions', () => {
  const withSuggestions = body(
    P('Kept.'),
    para([{ content: 'Inserted.\n', ins: true }]),
    para([{ content: 'Deleted.\n', del: true }]),
    para([{ content: 'Par' }, { content: 'tial add', ins: true }, { content: '.\n' }]),
  );

  it('hasSuggestions detects markers in DEFAULT JSON', () => {
    expect(GDocBuilder.hasSuggestions(withSuggestions)).toBe(true);
    expect(GDocBuilder.hasSuggestions(body(P('clean')))).toBe(false);
  });

  it('elementVisibility flags fully-inserted and fully-deleted paragraphs', () => {
    const vis = GDocBuilder.elementVisibility(withSuggestions);
    expect(vis).toEqual([
      { inBase: true, inAccepted: true },
      { inBase: false, inAccepted: true },
      { inBase: true, inAccepted: false },
      { inBase: true, inAccepted: true },
    ]);
  });

  it('mapIndex maps base indices into accepted space', () => {
    const vis = GDocBuilder.elementVisibility(withSuggestions);
    expect(GDocBuilder.mapIndex(vis, 0, 'accepted')).toBe(0); // Kept.
    expect(GDocBuilder.mapIndex(vis, 1, 'accepted')).toBe(1); // Deleted. → clamps to last accepted seen
    expect(GDocBuilder.mapIndex(vis, 2, 'accepted')).toBe(2); // Partial
    expect(GDocBuilder.mapIndex(vis, 2, 'base')).toBe(2);     // base mode is identity
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd functions && npx vitest run scripts/gdoc-text-builder.test.ts`
Expected: PASS (fix builder, not tests, on mismatch — the contract strings are authoritative).

Note: `mapIndex` expectation for a deleted paragraph: base idx 1 = 'Inserted.'? No — base-visible elements are [Kept., Deleted., Partial] (insertion not in base), so base idx 1 = 'Deleted.', which is absent from accepted; accepted-visible = [Kept., Inserted., Partial] so it clamps to the last accepted index seen at that point (1). Base idx 2 = 'Partial' → accepted idx 2. If the implementation disagrees, re-derive by hand before changing either side.

---

### Task 4: Apps Script — Docs advanced service + suggestions param

**Files:**
- Modify: `functions/scripts/apps-script-source.ts` (whole-file rework)
- Read first: `functions/scripts/setup-apps-script.ts`, `functions/scripts/update-apps-script.ts` (how APPS_SCRIPT_CODE/manifest are consumed; keep their contract).

**Interfaces:**
- Consumes: `functions/scripts/gdoc-text-builder.js` raw source (embedded at module load via `fs.readFileSync`).
- Produces: deployed `doGet` accepting `docId`, `tab`, `suggestions` (`base` default | `accepted`); response = existing `GDocWebAppResponse` fields + `hasSuggestions: boolean`.

- [ ] **Step 1: Rework `apps-script-source.ts`.** Embed the builder file and replace the DocumentApp walk:

```ts
import { readFileSync } from 'fs';
import { join } from 'path';

/** Pure builder shared with vitest — embedded verbatim into the deployed script. */
const BUILDER_SOURCE = readFileSync(join(__dirname, 'gdoc-text-builder.js'), 'utf8');

export const APPS_SCRIPT_CODE = BUILDER_SOURCE + `
function getBookmarksAndText(docId, tabTitle, suggestionMode) {
  var mode = suggestionMode === 'accepted' ? 'accepted' : 'base';
  var viewMode = mode === 'accepted'
    ? 'PREVIEW_SUGGESTIONS_ACCEPTED'
    : 'PREVIEW_WITHOUT_SUGGESTIONS';

  // DocumentApp: tab discovery + bookmarks (Docs REST API does not expose bookmarks).
  var doc = DocumentApp.openById(docId);
  var tabs = doc.getTabs();
  var tab;
  if (tabTitle) {
    tab = tabs.find(function(t) { return t.getTitle() === tabTitle; });
    if (!tab) {
      return { error: 'Tab "' + tabTitle + '" not found. Available: ' + tabs.map(function(t) { return t.getTitle(); }).join(', ') };
    }
  } else {
    tab = tabs[0];
  }
  var tabId = tab.getId();

  // Docs advanced service: projected JSON for text, DEFAULT JSON for suggestion markers.
  var projected = Docs.Documents.get(docId, { suggestionsViewMode: viewMode, includeTabsContent: true });
  var defaultDoc = Docs.Documents.get(docId, { suggestionsViewMode: 'DEFAULT_FOR_CURRENT_ACCESS', includeTabsContent: true });

  function findTab(d, id) {
    var stack = (d.tabs || []).slice();
    while (stack.length) {
      var t = stack.shift();
      if (t.tabProperties && t.tabProperties.tabId === id) return t;
      if (t.childTabs) stack = stack.concat(t.childTabs);
    }
    return null;
  }
  var projTab = findTab(projected, tabId);
  var defTab = findTab(defaultDoc, tabId);
  if (!projTab || !projTab.documentTab) {
    return { error: 'Tab not found in Docs API response' };
  }

  var built = GDocBuilder.projectTab(projTab.documentTab.body, projTab.documentTab.lists);
  var vis = GDocBuilder.elementVisibility(defTab.documentTab.body);
  var docHasSuggestions = GDocBuilder.hasSuggestions(defTab.documentTab.body);

  // Bookmarks: DocumentApp position → base child index → projected element index → offset.
  var docTab = tab.asDocumentTab();
  var body = docTab.getBody();
  var bookmarks = docTab.getBookmarks();
  var bmResults = bookmarks.map(function(b) {
    var bpos = b.getPosition();
    var el = bpos.getElement();
    var elOff = bpos.getOffset();
    var cur = el;
    while (cur.getParent() &&
           cur.getParent().getType() !== DocumentApp.ElementType.BODY_SECTION) {
      cur = cur.getParent();
    }
    var baseIdx = body.getChildIndex(cur);
    var idx = GDocBuilder.mapIndex(vis, baseIdx, mode);
    var meta = built.childMeta[Math.min(idx, built.childMeta.length - 1)] || { startOffset: 0, prefixLen: 0, textLen: 0 };
    return {
      id: b.getId(),
      offset: meta.startOffset + meta.prefixLen + Math.min(elOff, meta.textLen)
    };
  });

  return {
    tabTitle: tab.getTitle(),
    tabId: tabId,
    textLength: built.text.length,
    text: built.text,
    bookmarks: bmResults,
    tabs: tabs.map(function(t) { return { title: t.getTitle(), id: t.getId() }; }),
    hasSuggestions: docHasSuggestions
  };
}

function doGet(e) {
  var params = e.parameter;
  var docId = params.docId;
  if (!docId) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'docId parameter required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var result;
  try {
    result = getBookmarksAndText(docId, params.tab || '', params.suggestions || 'base');
  } catch (err) {
    result = { error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
`;
```

- [ ] **Step 2: Enable the advanced service in the manifest** (same file):

```ts
export const APPS_SCRIPT_MANIFEST = {
  timeZone: 'America/Los_Angeles',
  dependencies: {
    enabledAdvancedServices: [
      { userSymbol: 'Docs', version: 'v1', serviceId: 'docs' },
    ],
  },
  exceptionLogging: 'STACKDRIVER',
  runtimeVersion: 'V8',
  webapp: {
    access: 'ANYONE_ANONYMOUS',
    executeAs: 'USER_DEPLOYING',
  },
  oauthScopes: [
    'https://www.googleapis.com/auth/documents.readonly',
    'https://www.googleapis.com/auth/documents',
  ],
};
```

- [ ] **Step 3: Verify the script string is syntactically valid V8 JS**

Run: `cd functions && npx tsx -e "import('./scripts/apps-script-source.ts').then(m => { new Function(m.APPS_SCRIPT_CODE); console.log('parses OK, length', m.APPS_SCRIPT_CODE.length); })"`
Expected: `parses OK, length <n>` (note: `new Function` only checks syntax; `Docs`/`DocumentApp` are runtime globals in Apps Script).

- [ ] **Step 4: Typecheck**

Run: `cd functions && npx tsc --noEmit`
Expected: clean. If `readFileSync(join(__dirname, ...))` breaks because the scripts run under tsx/ESM, use `join(process.cwd(), 'scripts', 'gdoc-text-builder.js')` guarded by existence check, or `new URL('.', import.meta.url).pathname` — match however `setup-apps-script.ts` resolves paths today.

---

### Task 5: Client toggle + change detection

**Files:**
- Modify: `src/components/GDocImportDialog.tsx`
- Modify: `src/hooks/useGDocChangeDetection.ts`
- Test: `src/components/GDocImportDialog.test.tsx` (extend existing)

**Interfaces:**
- Consumes: `fetchGDocInfo(docId, tab?, suggestions?)`, `SuggestionMode`, `GDocWebAppResponse.hasSuggestions` (Task 1).
- Produces: `DocSource` objects that include `suggestionMode: 'accepted'` when accepted-mode text was imported (key omitted for base).

- [ ] **Step 1: Write failing tests** (add to `src/components/GDocImportDialog.test.tsx`, following the file's existing mock pattern for `fetchGDocInfo` — read it first):

```tsx
it('shows the suggestions toggle only when the doc has suggestions, defaulting to accepted', async () => {
  mockFetchGDocInfo.mockResolvedValue({
    tabTitle: 'Tab 1', tabId: 't.0', textLength: 5, text: 'Hello',
    bookmarks: [], tabs: [{ title: 'Tab 1', id: 't.0' }], hasSuggestions: true,
  });
  // ...render dialog, enter URL, advance to content step (mirror existing tests)...
  expect(await screen.findByText('Suggestions accepted')).toBeInTheDocument();
  expect(screen.getByText('Original')).toBeInTheDocument();
});

it('hides the toggle when hasSuggestions is false or missing', async () => {
  mockFetchGDocInfo.mockResolvedValue({
    tabTitle: 'Tab 1', tabId: 't.0', textLength: 5, text: 'Hello',
    bookmarks: [], tabs: [{ title: 'Tab 1', id: 't.0' }],
  });
  // ...advance to content step...
  expect(screen.queryByText('Suggestions accepted')).not.toBeInTheDocument();
});

it('imports with suggestionMode accepted in the DocSource when toggle is on accepted', async () => {
  // ...advance to content step with hasSuggestions: true, click Import...
  expect(onImport).toHaveBeenCalledWith(
    expect.any(String),
    expect.objectContaining({ suggestionMode: 'accepted' }),
    expect.any(String),
  );
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run src/components/GDocImportDialog.test.tsx`
Expected: new tests FAIL.

- [ ] **Step 3: Implement in `GDocImportDialog.tsx`:**

State + refetch:

```tsx
import { SegmentedControl } from '@mantine/core';
import type { SuggestionMode } from '../../shared/gdocTypes';

const [hasSuggestions, setHasSuggestions] = useState(false);
const [suggestionMode, setSuggestionMode] = useState<SuggestionMode>('base');
```

Wherever a fetch result lands (`handleFetchTabs` and the tab-change fetch around line 120/160):

```tsx
setHasSuggestions(!!data.hasSuggestions);
// default to accepted the first time we learn the doc has suggestions
if (data.hasSuggestions && suggestionMode === 'base' && !userTouchedModeRef.current) {
  setSuggestionMode('accepted');
  // refetch in accepted mode so displayed text matches the default selection
  const accepted = await fetchGDocInfo(id, tabArg, 'accepted');
  applyTabData(accepted);   // whatever the existing setFullText/setBookmarks/parseSections block is — factor it out if needed
  return;
}
```

(Track user intent with `const userTouchedModeRef = useRef(false);` set true in the toggle's onChange. Reset `hasSuggestions`, `suggestionMode`, and the ref alongside the dialog's existing state reset.)

Toggle UI on the **content** step, above the section list:

```tsx
{hasSuggestions && (
  <SegmentedControl
    fullWidth
    value={suggestionMode}
    onChange={(v) => { userTouchedModeRef.current = true; handleModeChange(v as SuggestionMode); }}
    data={[
      { label: 'Original', value: 'base' },
      { label: 'Suggestions accepted', value: 'accepted' },
    ]}
  />
)}
```

```tsx
async function handleModeChange(mode: SuggestionMode) {
  setSuggestionMode(mode);
  setLoading(true); setError(null);
  try {
    const data = await fetchGDocInfo(docId, selectedTab, mode);
    applyTabData(data); // re-set fullText/bookmarks/sections from response
  } catch (err) {
    setError(err instanceof Error ? err.message : 'Failed to fetch document');
  } finally {
    setLoading(false);
  }
}
```

`makeSource` carries the mode (omit for base — Firestore rejects `undefined`):

```tsx
function makeSource(docId: string, tab: string, sectionIndex: number, docName: string, mode: SuggestionMode): DocSource {
  return {
    docId, tab, sectionIndex,
    docName: docName || undefined,
    ...(mode === 'accepted' ? { suggestionMode: 'accepted' as const } : {}),
  };
}
```

…and the import call site passes `suggestionMode`.

- [ ] **Step 4: `useGDocChangeDetection.ts`** — the hook re-reads the doc to detect changes; it must read in the same projection. Where it calls `fetchGDocInfo(docId, tab)` (line 39), thread the mode from the `DocSource` it's watching:

```ts
const data = await fetchGDocInfo(docId, tab, source.suggestionMode ?? 'base');
```

(Adapt to the hook's actual parameter names after reading the file — the source object it receives already is a `DocSource`.)

- [ ] **Step 5: Run tests + typecheck**

Run: `npx vitest run src/components/GDocImportDialog.test.tsx && npx tsc --noEmit`
Expected: PASS, clean.

---

### Task 6: Corpus equivalence harness

**Files:**
- Create: `functions/scripts/verify-gdoc-formatter.ts`
- Read first: `functions/scripts/update-apps-script.ts` and any existing script using firebase-admin for credential/init patterns; mirror them.

**Interfaces:**
- Consumes: two deployed web-app deployment IDs via env: `OLD_DEPLOYMENT_ID` (current prod, DocumentApp formatter) and `NEW_DEPLOYMENT_ID` (Task 4 code, secondary deployment).
- Produces: console report — per-(docId,tab) PASS/FAIL/SKIP + unified diffs, non-zero exit code on any FAIL.

- [ ] **Step 1: Write the harness**

```ts
/**
 * Before/after equivalence harness (spec gate).
 * Fetches every Google Doc referenced by any essay in Firestore through BOTH
 * the old (DocumentApp) and new (Docs API) web-app deployments in base mode,
 * and requires identical text, bookmarks, and tab lists.
 *
 * Usage:
 *   OLD_DEPLOYMENT_ID=AKfy... NEW_DEPLOYMENT_ID=AKfy... \
 *     npx tsx scripts/verify-gdoc-formatter.ts [--limit N]
 */
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const WEBAPP_BASE = 'https://script.google.com/macros/s';
const OLD_ID = process.env.OLD_DEPLOYMENT_ID;
const NEW_ID = process.env.NEW_DEPLOYMENT_ID;
if (!OLD_ID || !NEW_ID) {
  console.error('Set OLD_DEPLOYMENT_ID and NEW_DEPLOYMENT_ID');
  process.exit(1);
}

const limitArg = process.argv.indexOf('--limit');
const LIMIT = limitArg > -1 ? parseInt(process.argv[limitArg + 1], 10) : Infinity;

interface WebAppResp {
  text?: string;
  bookmarks?: Array<{ id: string; offset: number }>;
  tabs?: Array<{ title: string; id: string }>;
  error?: string;
}

async function fetchDeployment(deploymentId: string, docId: string, tab: string): Promise<WebAppResp> {
  const params = new URLSearchParams({ docId });
  if (tab) params.set('tab', tab);
  const res = await fetch(`${WEBAPP_BASE}/${deploymentId}/exec?${params}`, { redirect: 'follow' });
  if (!res.ok) return { error: `HTTP ${res.status}` };
  try { return await res.json() as WebAppResp; } catch { return { error: 'non-JSON response' }; }
}

function firstDiff(a: string, b: string): string {
  const max = Math.min(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] !== b[i]) {
      return `first divergence at char ${i}:\n  old: ${JSON.stringify(a.slice(Math.max(0, i - 40), i + 40))}\n  new: ${JSON.stringify(b.slice(Math.max(0, i - 40), i + 40))}`;
    }
  }
  return `length differs: old=${a.length} new=${b.length}\n  old tail: ${JSON.stringify(a.slice(max - 40))}\n  new tail: ${JSON.stringify(b.slice(max - 40))}`;
}

async function main() {
  initializeApp({ credential: applicationDefault(), projectId: 'essay-grader-83737x' });
  const db = getFirestore();

  // Collect distinct (docId, tab) pairs from all essays' source fields.
  const pairs = new Map<string, { docId: string; tab: string }>();
  const essays = await db.collectionGroup('essays').get();
  for (const doc of essays.docs) {
    const d = doc.data();
    for (const field of ['contentSource', 'promptSource', 'criteriaSource'] as const) {
      const s = d[field];
      if (s && typeof s.docId === 'string') {
        const key = `${s.docId}::${s.tab || ''}`;
        pairs.set(key, { docId: s.docId, tab: s.tab || '' });
      }
    }
  }
  console.log(`Found ${pairs.size} distinct (docId, tab) pairs across ${essays.size} essays.\n`);

  let pass = 0, fail = 0, skip = 0, n = 0;
  for (const { docId, tab } of pairs.values()) {
    if (++n > LIMIT) break;
    const label = `${docId.slice(0, 10)}…${tab ? ` [${tab}]` : ''}`;

    const oldResp = await fetchDeployment(OLD_ID, docId, tab);
    if (oldResp.error) { console.log(`SKIP ${label} — old deployment: ${oldResp.error}`); skip++; continue; }
    const newResp = await fetchDeployment(NEW_ID, docId, tab);
    if (newResp.error) { console.log(`FAIL ${label} — new deployment: ${newResp.error}`); fail++; continue; }

    const problems: string[] = [];
    if (oldResp.text !== newResp.text) problems.push(`TEXT MISMATCH — ${firstDiff(oldResp.text ?? '', newResp.text ?? '')}`);
    if (JSON.stringify(oldResp.bookmarks) !== JSON.stringify(newResp.bookmarks)) {
      problems.push(`BOOKMARKS MISMATCH — old=${JSON.stringify(oldResp.bookmarks)} new=${JSON.stringify(newResp.bookmarks)}`);
    }
    if (JSON.stringify(oldResp.tabs) !== JSON.stringify(newResp.tabs)) {
      problems.push(`TABS MISMATCH — old=${JSON.stringify(oldResp.tabs)} new=${JSON.stringify(newResp.tabs)}`);
    }

    if (problems.length === 0) { console.log(`PASS ${label}`); pass++; }
    else { console.log(`FAIL ${label}\n  ${problems.join('\n  ')}`); fail++; }

    await new Promise(r => setTimeout(r, 300)); // stay under Apps Script quotas
  }

  console.log(`\n=== ${pass} PASS, ${fail} FAIL, ${skip} SKIP ===`);
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(err => { console.error(err); process.exit(1); });
```

- [ ] **Step 2: Typecheck**

Run: `cd functions && npx tsc --noEmit`
Expected: clean. (Full harness execution happens at cutover, Task 7 — it needs deployments + prod credentials.)

---

### Task 7: Cutover checklist (operator-run; NOT for implementation agents)

- [ ] Deploy Task 4's script as a **secondary** Apps Script deployment (existing `update-apps-script.ts` flow; do not touch the prod deployment). Enabling the Docs advanced service will require re-authorizing the script once in the Apps Script editor.
- [ ] Empirical checkpoint 1: create a fixture Google Doc containing suggested insertions + deletions; fetch through old deployment and through new (`suggestions=base` and `suggestions=accepted`). Confirm old == new-base. If instead old == insertions-included, revisit `elementVisibility` per its comment and re-run Task 3 tests with updated expectations.
- [ ] Run the corpus harness: `OLD_DEPLOYMENT_ID=… NEW_DEPLOYMENT_ID=… npx tsx scripts/verify-gdoc-formatter.ts`. Gate: 100% PASS (SKIPs reviewed).
- [ ] Promote the new script to the production deployment ID (or update `VITE_GDOC_WEBAPP_DEPLOYMENT_ID`).
- [ ] Manual QA: import a doc with suggestions; toggle Original ↔ Suggestions accepted; verify text switches, sections stay sane, and re-analyze uses the imported projection.

## Self-review notes

- Spec coverage: types/toggle (T1, T5), single formatter via advanced service (T2, T4), hasSuggestions (T2, T4, T5), per-field mode persistence (T5), change-detection same-projection (T5), corpus harness + dual deployment + gate (T6, T7), suggestion fixtures (T3 + T7 empirical), bookmarks (T2 mapIndex + T4 hybrid — spec's "bookmarks from JSON" was corrected: the Docs REST API does not expose bookmark positions, so DocumentApp remains the bookmark source, mapped via elementVisibility/mapIndex).
- Types consistent across tasks: `SuggestionMode`, `hasSuggestions?: boolean`, `fetchGDocInfo(docId, tab?, suggestions?)`, `childMeta {startOffset, prefixLen, textLen}`.
