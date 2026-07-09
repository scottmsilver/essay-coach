import { describe, it, expect } from 'vitest';
import { RUBRICS, buildDimensionalPrompt, buildPairwisePrompt } from './rubrics';

describe('rubrics', () => {
  it('grammar weights false positives 2x coverage', () => {
    const g = RUBRICS.grammar;
    expect(g.weights.correctness).toBe(2);
    expect(g.weights.falsePositiveRestraint).toBe(2);
    expect(g.weights.coverage).toBe(1);
  });
  it('overall keeps the three existing dimensions', () => {
    expect(RUBRICS.overall.dimensions).toEqual(['specificity', 'actionability', 'socratic_tone']);
  });
  it('dimensional prompt embeds essay + feedback + every dimension', () => {
    const p = buildDimensionalPrompt('grammar', 'ESSAY_X', 'FB_Y', '[]');
    expect(p).toContain('ESSAY_X');
    expect(p).toContain('FB_Y');
    for (const d of RUBRICS.grammar.dimensions) expect(p.toLowerCase()).toContain(d.toLowerCase().slice(0, 6));
  });
  it('pairwise prompt labels A and B and both feedbacks', () => {
    const p = buildPairwisePrompt('transitions', 'E', 'AAA', 'BBB');
    expect(p).toContain('AAA'); expect(p).toContain('BBB');
    expect(p).toMatch(/FEEDBACK A/); expect(p).toMatch(/FEEDBACK B/);
  });
});
