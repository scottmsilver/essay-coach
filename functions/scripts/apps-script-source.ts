/**
 * The Apps Script source code deployed as a web app for Google Docs reading.
 * Shared between setup-apps-script.ts and update-apps-script.ts.
 *
 * Text extraction runs through the Docs advanced service (Docs.Documents.get
 * with suggestionsViewMode) and a pure JSON→text builder (gdoc-text-builder.js),
 * embedded verbatim so the same code runs under vitest. Bookmarks still come
 * from DocumentApp (the Docs REST API does not expose bookmark positions) and
 * are mapped into the projected text via elementVisibility/mapIndex.
 *
 * FORMAT CONTRACT (must stay in sync with src/utils/pasteHandler.ts):
 *   - Indented paragraphs → \t prefix
 *   - Bullet list items → • (•) prefix
 *   - Numbered list items → N. prefix
 *   - Paragraph separation → \n\n
 *   - Consecutive list items → \n
 */
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

  // Glyph override map: the REST API returns identical metadata for some
  // numbered vs bulleted lists (GLYPH_TYPE_UNSPECIFIED, no glyphSymbol);
  // only DocumentApp can tell them apart.
  var docTabForGlyphs = tab.asDocumentTab();
  var glyphBody = docTabForGlyphs.getBody();
  var glyphOverrides = {};
  for (var gi = 0; gi < glyphBody.getNumChildren(); gi++) {
    var gchild = glyphBody.getChild(gi);
    if (gchild.getType() === DocumentApp.ElementType.LIST_ITEM) {
      var gli = gchild.asListItem();
      var gt = gli.getGlyphType();
      var numbered = gt === DocumentApp.GlyphType.NUMBER ||
                     gt === DocumentApp.GlyphType.LATIN_UPPER ||
                     gt === DocumentApp.GlyphType.LATIN_LOWER ||
                     gt === DocumentApp.GlyphType.ROMAN_UPPER ||
                     gt === DocumentApp.GlyphType.ROMAN_LOWER;
      glyphOverrides[gli.getListId()] = numbered ? 'numbered' : 'bullet';
    }
  }

  var built = GDocBuilder.projectTab(projTab.documentTab.body, projTab.documentTab.lists, glyphOverrides);
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
    // Anonymous endpoint: never echo raw exception text (can leak API/access
    // internals). Details go to Stackdriver via console.error only.
    console.error('getBookmarksAndText failed', err);
    result = { error: 'Failed to fetch document' };
  }
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

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
