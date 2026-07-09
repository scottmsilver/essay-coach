import { describe, it, expect } from 'vitest';
import { parseDimensional, parsePairwise } from './index';

describe('parseDimensional', () => {
  it('extracts a JSON object embedded in prose', () => {
    const raw = 'Here you go: {"correctness":{"score":4,"rationale":"ok"},"coverage":{"score":3,"rationale":"meh"}} done';
    const j = parseDimensional(raw, ['correctness', 'coverage']);
    expect(j.dimensions.correctness.score).toBe(4);
    expect(j.dimensions.coverage.score).toBe(3);
  });
  it('throws when a required dimension is missing', () => {
    expect(() => parseDimensional('{"correctness":{"score":4,"rationale":"x"}}', ['correctness','coverage'])).toThrow();
  });
});
describe('parsePairwise', () => {
  it('reads winner + rationale', () => {
    expect(parsePairwise('{"winner":"B","rationale":"clearer"}').winner).toBe('B');
  });
});
