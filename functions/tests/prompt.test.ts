import { describe, it, expect } from 'vitest';
import { buildEvaluationPrompt, buildResubmissionPrompt, SYSTEM_PROMPT } from '../src/prompt';

describe('SYSTEM_PROMPT', () => {
  it('includes the 6+1 traits', () => {
    expect(SYSTEM_PROMPT).toContain('Ideas');
    expect(SYSTEM_PROMPT).toContain('Organization');
    expect(SYSTEM_PROMPT).toContain('Voice');
    expect(SYSTEM_PROMPT).toContain('Word Choice');
    expect(SYSTEM_PROMPT).toContain('Sentence Fluency');
    expect(SYSTEM_PROMPT).toContain('Conventions');
    expect(SYSTEM_PROMPT).toContain('Presentation');
  });

  it('includes score descriptors 1-6', () => {
    expect(SYSTEM_PROMPT).toContain('1 -');
    expect(SYSTEM_PROMPT).toContain('6 -');
  });

  it('mentions revision-oriented feedback', () => {
    expect(SYSTEM_PROMPT).toMatch(/revision|revise/i);
  });

  it('mentions Carol Jago', () => {
    expect(SYSTEM_PROMPT).toMatch(/jago/i);
  });
});

describe('buildEvaluationPrompt', () => {
  it('includes the assignment prompt', () => {
    const result = buildEvaluationPrompt({
      assignmentPrompt: 'Write about Hamlet',
      writingType: 'argumentative',
      content: 'My essay...',
    });
    expect(result).toContain('Write about Hamlet');
  });

  it('includes the writing type', () => {
    const result = buildEvaluationPrompt({
      assignmentPrompt: 'Prompt',
      writingType: 'narrative',
      content: 'My essay...',
    });
    expect(result).toContain('narrative');
  });

  it('includes the essay content', () => {
    const result = buildEvaluationPrompt({
      assignmentPrompt: 'Prompt',
      writingType: 'argumentative',
      content: 'The specific essay text here.',
    });
    expect(result).toContain('The specific essay text here.');
  });
});

describe('buildResubmissionPrompt', () => {
  it('includes previous evaluation context', () => {
    const result = buildResubmissionPrompt({
      assignmentPrompt: 'Prompt',
      writingType: 'argumentative',
      content: 'Revised essay...',
      previousEvaluation: '{"traits": {}}',
    });
    expect(result).toContain('previous evaluation');
    expect(result).toContain('Revised essay...');
    expect(result).toContain('comparisonToPrevious');
  });
});
