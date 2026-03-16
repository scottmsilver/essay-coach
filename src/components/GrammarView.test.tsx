import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderWithRouter } from '../test-utils';
import GrammarView from './GrammarView';
import type { GrammarAnalysis } from '../types';

const emptyAnalysis: GrammarAnalysis = {
  commaSplices: { locations: [] },
  runOnSentences: { locations: [] },
  fragments: { locations: [] },
  subjectVerbAgreement: { locations: [] },
  pronounReference: { locations: [] },
  verbTenseConsistency: { locations: [] },
  parallelStructure: { locations: [] },
  punctuationErrors: { locations: [] },
  missingCommas: { locations: [] },
  sentenceVariety: { avgLength: 15, distribution: { simple: 3, compound: 2, complex: 1, compoundComplex: 0 }, comment: 'Good variety.' },
  activePassiveVoice: { activeCount: 5, passiveCount: 1, passiveInstances: [] },
  modifierPlacement: { issues: [] },
  wordiness: { instances: [] },
  summary: { totalErrors: 0, errorsByCategory: { commaSplices: 0, runOnSentences: 0, fragments: 0, subjectVerbAgreement: 0, pronounReference: 0, verbTenseConsistency: 0, parallelStructure: 0, punctuationErrors: 0, missingCommas: 0 }, overallComment: 'Clean writing.', strengthAreas: ['Good grammar'], priorityFixes: [] },
};

function makeAnalysis(overrides: Partial<GrammarAnalysis> = {}): GrammarAnalysis {
  return { ...emptyAnalysis, ...overrides };
}

describe('GrammarView', () => {
  it('renders overall comment', () => {
    const analysis = makeAnalysis({
      summary: { ...emptyAnalysis.summary, overallComment: 'Solid mechanics overall.' },
    });
    renderWithRouter(<GrammarView content="Some essay text." analysis={analysis} />);
    expect(screen.getByText('Solid mechanics overall.')).toBeInTheDocument();
  });

  it('renders strength areas', () => {
    const analysis = makeAnalysis({
      summary: { ...emptyAnalysis.summary, strengthAreas: ['Consistent verb tense', 'Clear pronoun reference'] },
    });
    renderWithRouter(<GrammarView content="Some essay text." analysis={analysis} />);
    expect(screen.getByText('Consistent verb tense')).toBeInTheDocument();
    expect(screen.getByText('Clear pronoun reference')).toBeInTheDocument();
  });

  it('renders priority fixes', () => {
    const analysis = makeAnalysis({
      summary: { ...emptyAnalysis.summary, priorityFixes: ['Fix comma splices', 'Address run-on sentences'] },
    });
    renderWithRouter(<GrammarView content="Some essay text." analysis={analysis} />);
    expect(screen.getByText('Fix comma splices')).toBeInTheDocument();
    expect(screen.getByText('Address run-on sentences')).toBeInTheDocument();
  });

  it('renders "No issues found" when no issues', () => {
    renderWithRouter(<GrammarView content="Perfect essay." analysis={emptyAnalysis} />);
    expect(screen.getByText('No issues found')).toBeInTheDocument();
  });

  it('renders error count badge', () => {
    const analysis = makeAnalysis({
      commaSplices: {
        locations: [{ sentence: 'I ran, I jumped.', quotedText: 'ran, I', comment: 'Comma splice here.', severity: 'error' }],
      },
    });
    renderWithRouter(<GrammarView content="I ran, I jumped." analysis={analysis} />);
    expect(screen.getByText('1 error')).toBeInTheDocument();
  });

  it('renders warning count badge', () => {
    const analysis = makeAnalysis({
      missingCommas: {
        locations: [{ sentence: 'However the dog ran.', quotedText: 'However the', comment: 'Add comma after introductory word.', severity: 'warning' }],
      },
    });
    renderWithRouter(<GrammarView content="However the dog ran." analysis={analysis} />);
    expect(screen.getByText('1 warning')).toBeInTheDocument();
  });

  it('renders category buttons for non-zero categories', () => {
    const analysis = makeAnalysis({
      commaSplices: {
        locations: [{ sentence: 'I ran, I jumped.', quotedText: 'ran, I', comment: 'Comma splice.', severity: 'error' }],
      },
    });
    const { container } = renderWithRouter(<GrammarView content="I ran, I jumped." analysis={analysis} />);
    const btn = container.querySelector('.grammar-category-btn');
    expect(btn).toBeInTheDocument();
    expect(btn?.textContent).toContain('Comma Splices');
  });

  it('renders essay content', () => {
    renderWithRouter(<GrammarView content="The quick brown fox jumps over the lazy dog." analysis={emptyAnalysis} />);
    expect(screen.getByText('The quick brown fox jumps over the lazy dog.')).toBeInTheDocument();
  });

  it('highlights error text with underline', () => {
    const analysis = makeAnalysis({
      commaSplices: {
        locations: [{ sentence: 'I ran, I jumped over the fence.', quotedText: 'ran, I', comment: 'Comma splice.', severity: 'error' }],
      },
    });
    const { container } = renderWithRouter(
      <GrammarView content="I ran, I jumped over the fence." analysis={analysis} />
    );
    const underline = container.querySelector('.grammar-underline');
    expect(underline).toBeInTheDocument();
    expect(underline?.textContent).toBe('ran, I');
  });

  it('shows comment when clicking underlined text', async () => {
    const analysis = makeAnalysis({
      commaSplices: {
        locations: [{ sentence: 'I ran, I jumped.', quotedText: 'ran, I', comment: 'Use a semicolon or period instead.', severity: 'error' }],
      },
    });
    const { container } = renderWithRouter(
      <GrammarView content="I ran, I jumped." analysis={analysis} />
    );
    const underline = container.querySelector('.grammar-underline')!;
    await userEvent.click(underline);
    expect(screen.getByText('Use a semicolon or period instead.')).toBeInTheDocument();
    // Comment appears in the sidebar with a trait label
    const label = container.querySelector('.sidebar-comment-trait');
    expect(label).toBeInTheDocument();
    expect(label?.textContent).toBe('Comma Splices');
  });

  it('shows sentence variety stats', () => {
    const analysis = makeAnalysis({
      sentenceVariety: { avgLength: 18, distribution: { simple: 5, compound: 3, complex: 2, compoundComplex: 1 }, comment: 'Nice variety.' },
    });
    renderWithRouter(<GrammarView content="Some text." analysis={analysis} />);
    expect(screen.getByText('Avg length: 18 words')).toBeInTheDocument();
    expect(screen.getByText('Simple: 5')).toBeInTheDocument();
    expect(screen.getByText('Compound: 3')).toBeInTheDocument();
    expect(screen.getByText('Complex: 2')).toBeInTheDocument();
    expect(screen.getByText('Compound-Complex: 1')).toBeInTheDocument();
  });

  it('shows active/passive voice ratio', () => {
    renderWithRouter(<GrammarView content="Some text." analysis={emptyAnalysis} />);
    expect(screen.getByText(/5 active, 1 passive/)).toBeInTheDocument();
  });

  it('filters issues by category when clicking category button', async () => {
    const analysis = makeAnalysis({
      commaSplices: {
        locations: [{ sentence: 'I ran, I jumped.', quotedText: 'ran, I', comment: 'Comma splice.', severity: 'error' }],
      },
      fragments: {
        locations: [{ sentence: 'Because reasons.', quotedText: 'Because reasons.', comment: 'Sentence fragment.', severity: 'error' }],
      },
    });
    const { container } = renderWithRouter(
      <GrammarView content="I ran, I jumped. Because reasons." analysis={analysis} />
    );

    // Before filtering, both issues should be underlined
    let underlines = container.querySelectorAll('.grammar-underline');
    expect(underlines.length).toBe(2);

    // Click the "Comma Splices" category button to filter
    const csButton = Array.from(container.querySelectorAll('.grammar-category-btn'))
      .find(btn => btn.textContent?.includes('Comma Splices'))!;
    await userEvent.click(csButton);

    // After filtering, only the comma splice should be underlined
    underlines = container.querySelectorAll('.grammar-underline');
    expect(underlines.length).toBe(1);
    expect(underlines[0].textContent).toBe('ran, I');
  });
});
