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

describe('degenerate lists (corpus-harness finding)', () => {
  // REST metadata is IDENTICAL for these numbered vs bulleted lists —
  // GLYPH_TYPE_UNSPECIFIED, no glyphSymbol. The caller passes a DocumentApp-
  // derived override map to disambiguate.
  const AMBIGUOUS = {
    L3: { listProperties: { nestingLevels: [{ glyphType: 'GLYPH_TYPE_UNSPECIFIED', startNumber: 1 }] } },
  };

  it('numbers an ambiguous list when the override says numbered', () => {
    const { text } = GDocBuilder.projectTab(
      body(P('first', { bullet: { listId: 'L3' } }), P('second', { bullet: { listId: 'L3' } })),
      AMBIGUOUS,
      { L3: 'numbered' },
    );
    expect(text).toBe('1. first\n2. second');
  });

  it('bullets an ambiguous list when the override says bullet', () => {
    const { text } = GDocBuilder.projectTab(
      body(P('a', { bullet: { listId: 'L3' } })),
      AMBIGUOUS,
      { L3: 'bullet' },
    );
    expect(text).toBe('• a');
  });

  it('falls back to bullet for ambiguous lists with no override (pre-existing default)', () => {
    const { text } = GDocBuilder.projectTab(
      body(P('a', { bullet: { listId: 'L3' } })),
      AMBIGUOUS,
    );
    expect(text).toBe('• a');
  });

  it('override does not affect lists with explicit glyph metadata', () => {
    const { text } = GDocBuilder.projectTab(
      body(P('a', { bullet: { listId: 'L2' } })),
      BULLET_LISTS,
      { L2: 'numbered' }, // glyphSymbol wins — override only breaks ties
    );
    expect(text).toBe('• a');
  });
});

describe('soft line breaks (corpus-harness finding)', () => {
  it('normalizes \\u000B vertical tabs to \\r to match DocumentApp', () => {
    const { text } = GDocBuilder.projectTab(
      body(para([{ content: 'line one\u000Bline two\n' }])),
      {},
    );
    expect(text).toBe('line one\rline two');
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
