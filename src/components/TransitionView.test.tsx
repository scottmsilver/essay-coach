import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import { renderWithRouter } from '../test-utils';
import TransitionView from './TransitionView';
import type { TransitionAnalysis } from '../types';

const TWO_PARAGRAPH_CONTENT = 'First sentence here. Second sentence here.\n\nThird sentence in paragraph two. Fourth sentence.';

const analysisWithRecordSentences: TransitionAnalysis = {
  sentenceTransitions: [
    { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'smooth', comment: 'Nice flow.' },
    { paragraph: 2, fromSentence: 1, toSentence: 2, quality: 'weak', comment: 'Abrupt shift.' },
  ],
  paragraphTransitions: [
    { fromParagraph: 1, toParagraph: 2, quality: 'adequate', comment: 'Could be stronger.' },
  ],
  summary: 'Overall decent transitions.',
  sentences: {
    '0': ['First sentence here.', 'Second sentence here.'],
    '1': ['Third sentence in paragraph two.', 'Fourth sentence.'],
  },
};

const analysisWithoutSentences: TransitionAnalysis = {
  sentenceTransitions: [
    { paragraph: 1, fromSentence: 1, toSentence: 2, quality: 'smooth', comment: 'Nice flow.' },
    { paragraph: 2, fromSentence: 1, toSentence: 2, quality: 'weak', comment: 'Abrupt shift.' },
  ],
  paragraphTransitions: [
    { fromParagraph: 1, toParagraph: 2, quality: 'adequate', comment: 'Could be stronger.' },
  ],
  summary: 'Overall decent transitions.',
};

describe('TransitionView', () => {
  it('renders summary text', () => {
    renderWithRouter(
      <TransitionView content={TWO_PARAGRAPH_CONTENT} analysis={analysisWithRecordSentences} />,
    );
    expect(screen.getByText('Overall decent transitions.')).toBeInTheDocument();
  });

  it('renders quality counts in legend', () => {
    renderWithRouter(
      <TransitionView content={TWO_PARAGRAPH_CONTENT} analysis={analysisWithRecordSentences} />,
    );
    expect(screen.getByText(/1 smooth/)).toBeInTheDocument();
    expect(screen.getByText(/1 weak/)).toBeInTheDocument();
    expect(screen.getByText(/1 adequate/)).toBeInTheDocument();
  });

  it('renders sentence text from Record<string, string[]> sentences', () => {
    renderWithRouter(
      <TransitionView content={TWO_PARAGRAPH_CONTENT} analysis={analysisWithRecordSentences} />,
    );
    expect(screen.getByText(/First sentence here\./)).toBeInTheDocument();
    expect(screen.getByText(/Second sentence here\./)).toBeInTheDocument();
    expect(screen.getByText(/Third sentence in paragraph two\./)).toBeInTheDocument();
    expect(screen.getByText(/Fourth sentence\./)).toBeInTheDocument();
  });

  it('renders transition dots between sentences', () => {
    const { container } = renderWithRouter(
      <TransitionView content={TWO_PARAGRAPH_CONTENT} analysis={analysisWithRecordSentences} />,
    );
    const dots = container.querySelectorAll('.transition-dot');
    expect(dots.length).toBe(2); // one per sentence transition
    expect(dots[0].className).toContain('smooth');
    expect(dots[1].className).toContain('weak');
  });

  it('renders paragraph transition marker', () => {
    const { container } = renderWithRouter(
      <TransitionView content={TWO_PARAGRAPH_CONTENT} analysis={analysisWithRecordSentences} />,
    );
    const markers = container.querySelectorAll('.transition-marker');
    expect(markers.length).toBe(1);
    expect(markers[0].className).toContain('adequate');
    expect(markers[0].textContent).toContain('¶1');
    expect(markers[0].textContent).toContain('¶2');
  });

  it('falls back to regex splitting when sentences field is missing (old data)', () => {
    renderWithRouter(
      <TransitionView content={TWO_PARAGRAPH_CONTENT} analysis={analysisWithoutSentences} />,
    );
    // Should still render sentences from regex fallback
    expect(screen.getByText(/First sentence here\./)).toBeInTheDocument();
    expect(screen.getByText(/Fourth sentence\./)).toBeInTheDocument();
  });

  it('renders all sentences even with many paragraphs in Record format', () => {
    const analysis: TransitionAnalysis = {
      sentenceTransitions: [],
      paragraphTransitions: [],
      summary: 'Test.',
      sentences: {
        '0': ['Alpha.'],
        '1': ['Beta.'],
        '2': ['Gamma.'],
      },
    };
    renderWithRouter(
      <TransitionView content="Alpha.\n\nBeta.\n\nGamma." analysis={analysis} />,
    );
    expect(screen.getByText(/Alpha\./)).toBeInTheDocument();
    expect(screen.getByText(/Beta\./)).toBeInTheDocument();
    expect(screen.getByText(/Gamma\./)).toBeInTheDocument();
  });

  it('renders essay text with 12 paragraphs and 59 sentence transitions (production-like)', () => {
    // Mimics the actual production data shape: 12 paragraphs, many transitions
    const sentences: Record<string, string[]> = {
      '0': ['Executive Mansion, Washington'],
      '1': ['Dear Sir,'],
      '2': ['I leave home in Washington this morning.', 'As I reflect upon your ascension.', 'I congratulate you.', 'I know you have no time.', 'Do not.', 'Yet I feel compelled.'],
      '3': ['Not long after I put a stop.', 'You may recall my appropriations bill.', 'They sought to repeal.', 'I stood my ground.', 'I vetoed such bills seven times.'],
      '4': ['My defense of the office.', 'Consider my struggle with Conkling.', 'He forced custom clerks.', 'When I ordered the removal.'],
      '5': ['Thinking my battle was enough.', 'I must confess my mistakes.', 'I only wish.'],
      '6': ['Let the mistakes of my tenure.', 'Though I largely advise you.', 'In my desire to placate.', 'I made a grave error.'],
      '7': ['Equal rights are not the only backbone.', 'Our economic stability was threatened.', 'I am proud to have returned.'],
      '8': ['A strong currency is only the foundation.', 'A divided nation can only heal.', 'I failed in my noble attempt.'],
      '9': ['The burden of this office is immense.', 'You must rely on your conscience.'],
      '10': ['With kindest regards from the missus and me,'],
      '11': ['R.B. Hayes'],
    };

    const sentenceTransitions: TransitionAnalysis['sentenceTransitions'] = [];
    // Generate transitions for each paragraph's consecutive sentences
    for (const [key, sents] of Object.entries(sentences)) {
      const pi = Number(key) + 1;
      for (let si = 1; si < sents.length; si++) {
        sentenceTransitions.push({
          paragraph: pi,
          fromSentence: si,
          toSentence: si + 1,
          quality: si % 3 === 0 ? 'weak' : 'smooth',
          comment: `Transition ${pi}-${si}.`,
        });
      }
    }

    const paragraphTransitions: TransitionAnalysis['paragraphTransitions'] = [];
    for (let i = 1; i < Object.keys(sentences).length; i++) {
      paragraphTransitions.push({
        fromParagraph: i,
        toParagraph: i + 1,
        quality: i % 2 === 0 ? 'adequate' : 'smooth',
        comment: `Para transition ${i}.`,
      });
    }

    const analysis: TransitionAnalysis = {
      sentenceTransitions,
      paragraphTransitions,
      summary: 'Well structured letter.',
      sentences,
    };

    const content = Object.values(sentences).map(s => s.join(' ')).join('\n\n');

    const { container } = renderWithRouter(
      <TransitionView content={content} analysis={analysis} />,
    );

    // Summary renders
    expect(screen.getByText('Well structured letter.')).toBeInTheDocument();

    // Essay sentences render
    expect(screen.getByText(/Executive Mansion/)).toBeInTheDocument();
    expect(screen.getByText(/R\.B\. Hayes/)).toBeInTheDocument();
    expect(screen.getByText(/I leave home in Washington/)).toBeInTheDocument();

    // Transition dots render
    const dots = container.querySelectorAll('.transition-dot');
    expect(dots.length).toBe(sentenceTransitions.length);

    // Paragraph transition markers render
    const markers = container.querySelectorAll('.transition-marker');
    expect(markers.length).toBe(paragraphTransitions.length);

    // Verify annotated-essay div has content (not empty)
    const essayDiv = container.querySelector('.transition-essay');
    expect(essayDiv).not.toBeNull();
    expect(essayDiv!.children.length).toBeGreaterThan(0);
  });
});
