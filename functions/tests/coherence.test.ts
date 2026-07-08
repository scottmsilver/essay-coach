import { describe, it, expect } from 'vitest';
import { buildCoherencePrompt } from '../src/coherence';

describe('buildCoherencePrompt', () => {
  const baseInput = {
    writingType: 'argumentative',
    assignmentPrompt: 'Write an argumentative essay about climate change.',
    content: 'Climate change is a pressing issue.\n\nWe must act now.',
  };

  it('builds a prompt with assignment context and the essay', () => {
    const prompt = buildCoherencePrompt(baseInput);
    expect(prompt).toContain('argumentative');
    expect(prompt).toContain('Assignment prompt');
    expect(prompt).toContain('Write an argumentative essay about climate change.');
    expect(prompt).toContain('Climate change is a pressing issue.');
    expect(prompt).toContain('Return the thesis paragraph');
  });

  it('falls back when no assignment prompt is provided', () => {
    const prompt = buildCoherencePrompt({ ...baseInput, assignmentPrompt: '' });
    expect(prompt).toContain('(none provided)');
  });
});
