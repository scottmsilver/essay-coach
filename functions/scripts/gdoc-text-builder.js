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
  // Null-prototype lookup tables: doc JSON supplies glyphType/listId strings,
  // so plain {} would let keys like "constructor"/"__proto__" hit Object
  // prototype members.
  var NUMBERED_GLYPHS = Object.create(null);
  ['DECIMAL', 'ZERO_DECIMAL', 'ALPHA', 'UPPER_ALPHA', 'ROMAN', 'UPPER_ROMAN']
    .forEach(function (g) { NUMBERED_GLYPHS[g] = true; });

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
    var listCounters = Object.create(null);

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
          listCounters = Object.create(null);
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
