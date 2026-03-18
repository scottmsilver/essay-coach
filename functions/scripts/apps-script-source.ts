/**
 * The Apps Script source code deployed as a web app for Google Docs reading.
 * Shared between setup-apps-script.ts and update-apps-script.ts.
 *
 * Preserves paragraph formatting: first-line indentation (\t prefix),
 * paragraph spacing (\n\n between paragraphs), and list markers (• or N.).
 *
 * FORMAT CONTRACT (must stay in sync with src/utils/pasteHandler.ts):
 *   - Indented paragraphs → \t prefix
 *   - Bullet list items → \u2022 (•) prefix
 *   - Numbered list items → N. prefix
 *   - Paragraph separation → \n\n
 *   - Consecutive list items → \n
 */
export const APPS_SCRIPT_CODE = `
function getBookmarksAndText(docId, tabTitle) {
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

  var docTab = tab.asDocumentTab();
  var body = docTab.getBody();
  var n = body.getNumChildren();

  // Build text preserving paragraph indentation, spacing, and list markers.
  // childMeta[i] = { startOffset, prefixLen } for bookmark offset mapping.
  var childMeta = [];
  var chunks = [];
  var pos = 0;
  var listCounters = {};

  for (var i = 0; i < n; i++) {
    var child = body.getChild(i);
    var ctype = child.getType();
    var ctext = '';
    var prefix = '';

    if (ctype === DocumentApp.ElementType.PARAGRAPH) {
      ctext = child.asParagraph().getText();
      if (ctext.length > 0) {
        var indent = child.asParagraph().getIndentFirstLine();
        if (indent !== null && indent > 0) prefix = '\\t';
      }
      listCounters = {};
    } else if (ctype === DocumentApp.ElementType.LIST_ITEM) {
      ctext = child.asListItem().getText();
      var g = child.asListItem().getGlyphType();
      var listId = child.asListItem().getListId();
      if (g === DocumentApp.GlyphType.NUMBER ||
          g === DocumentApp.GlyphType.LATIN_UPPER ||
          g === DocumentApp.GlyphType.LATIN_LOWER ||
          g === DocumentApp.GlyphType.ROMAN_UPPER ||
          g === DocumentApp.GlyphType.ROMAN_LOWER) {
        if (!listCounters[listId]) listCounters[listId] = 0;
        listCounters[listId]++;
        prefix = listCounters[listId] + '. ';
      } else {
        prefix = '\\u2022 ';
      }
    }

    childMeta.push({ startOffset: pos, prefixLen: prefix.length });
    chunks.push(prefix + ctext);
    pos += prefix.length + ctext.length;

    // Separator: single \\n between consecutive list items, double \\n\\n otherwise
    if (i < n - 1) {
      var nextType = body.getChild(i + 1).getType();
      if (ctype === DocumentApp.ElementType.LIST_ITEM &&
          nextType === DocumentApp.ElementType.LIST_ITEM) {
        pos += 1;
      } else {
        chunks.push('');
        pos += 2;
      }
    }
  }

  var text = chunks.join('\\n');

  // Resolve bookmark offsets in the formatted text
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
    var ci = body.getChildIndex(cur);
    return {
      id: b.getId(),
      offset: childMeta[ci].startOffset + childMeta[ci].prefixLen + elOff
    };
  });

  return {
    tabTitle: tab.getTitle(),
    tabId: tab.getId(),
    textLength: text.length,
    text: text,
    bookmarks: bmResults,
    tabs: tabs.map(function(t) { return { title: t.getTitle(), id: t.getId() }; })
  };
}

function doGet(e) {
  var params = e.parameter;
  var docId = params.docId;
  if (!docId) {
    return ContentService.createTextOutput(JSON.stringify({ error: 'docId parameter required' }))
      .setMimeType(ContentService.MimeType.JSON);
  }
  var result = getBookmarksAndText(docId, params.tab || '');
  return ContentService.createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
`;

export const APPS_SCRIPT_MANIFEST = {
  timeZone: 'America/Los_Angeles',
  dependencies: {},
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
