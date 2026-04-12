import { describe, it, expect } from 'vitest';
import { buildCriteriaPrompt } from '../src/criteria';

describe('buildCriteriaPrompt', () => {
  const baseInput = {
    teacherCriteria: '1. Clear thesis statement\n2. Three supporting paragraphs\n3. Proper MLA citations',
    assignmentPrompt: 'Write an argumentative essay about climate change.',
    writingType: 'argumentative',
    content: 'Climate change is a pressing issue...',
  };

  it('builds a first-submission prompt with no comparison section', () => {
    const prompt = buildCriteriaPrompt(baseInput);
    expect(prompt).toContain("## Teacher's Criteria");
    expect(prompt).toContain('Clear thesis statement');
    expect(prompt).toContain('## Assignment Prompt');
    expect(prompt).toContain('## Student Essay');
    expect(prompt).toContain('Set "comparisonToPrevious" to null');
    expect(prompt).not.toContain('Previous Criteria Analysis');
  });

  it('builds a resubmission prompt with previous analysis', () => {
    const prompt = buildCriteriaPrompt({
      ...baseInput,
      previousCriteriaAnalysis: '{"criteria":[]}',
    });
    expect(prompt).toContain('## Previous Criteria Analysis');
    expect(prompt).toContain('Include the "comparisonToPrevious" field');
  });

  it('includes previous snapshot when criteria changed', () => {
    const prompt = buildCriteriaPrompt({
      ...baseInput,
      previousCriteriaAnalysis: '{"criteria":[]}',
      previousCriteriaSnapshot: 'Old criteria that was different',
    });
    expect(prompt).toContain('## Previous Criteria Text');
    expect(prompt).toContain('Old criteria that was different');
  });

  it('omits previous snapshot section when criteria unchanged', () => {
    const prompt = buildCriteriaPrompt({
      ...baseInput,
      previousCriteriaAnalysis: '{"criteria":[]}',
      previousCriteriaSnapshot: baseInput.teacherCriteria,
    });
    expect(prompt).not.toContain('## Previous Criteria Text');
  });
});
