import { describe, it, expect } from 'vitest';
import { stabilizeResults } from './transitions';
import type { TransitionAnalysis, SentenceTransition, ParagraphTransition } from '../../shared/transitionTypes';

function makeAnalysis(
  sentenceTransitions: SentenceTransition[],
  paragraphTransitions: ParagraphTransition[],
  sentences: Record<string, string[]>,
): TransitionAnalysis {
  return { sentenceTransitions, paragraphTransitions, summary: 'Test.', sentences };
}

describe('stabilizeResults', () => {
  it('carries forward sentence transitions when the whole paragraph is unchanged', () => {
    const sentences: Record<string, string[]> = {
      '0': ['First.', 'Second.', 'Third.'],
    };

    const previous = makeAnalysis(
      [
        { paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'smooth', comment: 'Great.' },
        { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'weak', comment: 'Abrupt.' },
      ],
      [], sentences,
    );

    // Gemini flips on the same text
    const fresh = makeAnalysis(
      [
        { paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'adequate', comment: 'OK.' },
        { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'adequate', comment: 'Decent.' },
      ],
      [], sentences,
    );

    const result = stabilizeResults(fresh, previous, sentences);
    expect(result.sentenceTransitions[0].quality).toBe('smooth');
    expect(result.sentenceTransitions[1].quality).toBe('weak');
  });

  it('uses fresh results when a paragraph has changed', () => {
    const prevSentences: Record<string, string[]> = {
      '0': ['First.', 'Old second.', 'Third.'],
    };
    const currSentences: Record<string, string[]> = {
      '0': ['First.', 'New second.', 'Third.'],
    };

    const previous = makeAnalysis(
      [{ paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'smooth', comment: 'Old.' }],
      [], prevSentences,
    );

    const fresh = makeAnalysis(
      [{ paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'weak', comment: 'Fresh.' }],
      [], currSentences,
    );

    const result = stabilizeResults(fresh, previous, currSentences);
    expect(result.sentenceTransitions[0].quality).toBe('weak');
    expect(result.sentenceTransitions[0].comment).toBe('Fresh.');
  });

  it('carries forward paragraph transition when both paragraphs are unchanged', () => {
    const sentences: Record<string, string[]> = {
      '0': ['P1 sent 1.', 'P1 last.'],
      '1': ['P2 first.', 'P2 sent 2.'],
    };

    const previous = makeAnalysis(
      [],
      [{ fromParagraph: 1, toParagraph: 2, quality: 'missing', comment: 'No link.' }],
      sentences,
    );

    const fresh = makeAnalysis(
      [],
      [{ fromParagraph: 1, toParagraph: 2, quality: 'adequate', comment: 'Some link.' }],
      sentences,
    );

    const result = stabilizeResults(fresh, previous, sentences);
    expect(result.paragraphTransitions[0].quality).toBe('missing');
  });

  it('uses fresh paragraph transition when one paragraph changed', () => {
    const prevSentences: Record<string, string[]> = {
      '0': ['P1 sent 1.', 'Old P1 last.'],
      '1': ['P2 first.', 'P2 sent 2.'],
    };
    const currSentences: Record<string, string[]> = {
      '0': ['P1 sent 1.', 'New P1 last.'],
      '1': ['P2 first.', 'P2 sent 2.'],
    };

    const previous = makeAnalysis(
      [],
      [{ fromParagraph: 1, toParagraph: 2, quality: 'missing', comment: 'Old.' }],
      prevSentences,
    );

    const fresh = makeAnalysis(
      [],
      [{ fromParagraph: 1, toParagraph: 2, quality: 'smooth', comment: 'Fresh.' }],
      currSentences,
    );

    const result = stabilizeResults(fresh, previous, currSentences);
    expect(result.paragraphTransitions[0].quality).toBe('smooth');
    expect(result.paragraphTransitions[0].comment).toBe('Fresh.');
  });

  it('returns fresh results when no previous analysis exists', () => {
    const sentences: Record<string, string[]> = { '0': ['One.', 'Two.'] };

    const fresh = makeAnalysis(
      [{ paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'weak', comment: 'New.' }],
      [], sentences,
    );

    const result = stabilizeResults(fresh, null, sentences);
    expect(result.sentenceTransitions[0].quality).toBe('weak');
  });

  it('stabilizes unchanged paragraphs even when sentence splits differ', () => {
    // Same paragraph text, but Gemini split sentences differently between runs
    const prevSentences: Record<string, string[]> = {
      '0': ['Hello world.', 'This is a test.'],  // split into 2
    };
    const currSentences: Record<string, string[]> = {
      '0': ['Hello world. This is', 'a test.'],   // split differently
    };
    // But paragraph text is the same: "Hello world. This is a test."
    // Wait — joining gives different text. This shouldn't stabilize.
    // Let me make them actually the same joined text.
    const prevSentences2: Record<string, string[]> = {
      '0': ['Hello world.', 'This is a test.'],
    };
    const currSentences2: Record<string, string[]> = {
      '0': ['Hello', 'world. This is a test.'],
    };
    // Joined: "Hello world. This is a test." vs "Hello world. This is a test." — same!

    const previous = makeAnalysis(
      [{ paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'smooth', comment: 'Cached.' }],
      [], prevSentences2,
    );

    const fresh = makeAnalysis(
      [{ paragraph: 1, fromSentence: 0, toSentence: 1, quality: 'weak', comment: 'Fresh.' }],
      [], currSentences2,
    );

    const result = stabilizeResults(fresh, previous, currSentences2);
    // Paragraph text matches when joined → carry forward
    expect(result.sentenceTransitions[0].quality).toBe('smooth');
    expect(result.sentenceTransitions[0].comment).toBe('Cached.');
  });
});
