import { describe, it, expect, vi } from 'vitest';
import { runEvalCore, validateEvalInput, type EvalDeps, type EvalRunInput, type EvalItemDoc } from '../src/evalRun';
import type { Judge } from '../../shared/panel/types';

// Mirrors shared/panel/run-panel.test.ts's mockJudge style, extended to
// consistently prefer one *content side* regardless of AB/BA call order
// (runItem always calls judgePairwise with the AB prompt first, BA second).
// A judge that just returned a fixed winner string would look
// position-biased/disagreeing to aggregateItem's order-correction logic even
// when it has a stable, genuine preference — this mirrors what a real judge
// that isn't position-sensitive would produce.
function mockJudge(id: string, prefer: 'A' | 'B' | 'tie'): Judge {
  let pairwiseCallCount = 0;
  return {
    id,
    lab: 'anthropic',
    judgeDimensional: vi.fn(async () => ({
      dimensions: {
        correctness: { score: 4, rationale: '' },
        coverage: { score: 3, rationale: '' },
        falsePositiveRestraint: { score: 4, rationale: '' },
        fixGuidance: { score: 3, rationale: '' },
      },
    })),
    judgePairwise: vi.fn(async () => {
      pairwiseCallCount++;
      if (prefer === 'tie') return { winner: 'tie' as const, rationale: '' };
      // Odd calls = AB order (content A in slot 1): report the preferred
      // content as-is. Even calls = BA order (content B in slot 1): flip the
      // slot label so the same *content* preference is reported regardless
      // of which essay/item this call belongs to.
      const isABOrder = pairwiseCallCount % 2 === 1;
      const winner = isABOrder ? prefer : prefer === 'A' ? 'B' : 'A';
      return { winner, rationale: '' };
    }),
  };
}

function makeDeps(overrides: Partial<EvalDeps> = {}): EvalDeps & {
  writeItem: ReturnType<typeof vi.fn>;
  writeProgress: ReturnType<typeof vi.fn>;
} {
  const writeItem = vi.fn(async () => {});
  const writeProgress = vi.fn(async () => {});
  return {
    generate: vi.fn(async () => ({ feedback: 'FEEDBACK', annotations: '[]' })),
    judges: [mockJudge('a', 'A'), mockJudge('b', 'A')],
    writeProgress,
    writeItem,
    rand: () => 0.99, // above the 0.05 sample rate unless overridden
    ...overrides,
  };
}

describe('runEvalCore', () => {
  it('happy path: 2 essays produce a verdict shape, writeItem called twice, progress monotonic 0->total', async () => {
    const deps = makeDeps();
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [
        { id: 'e1', content: 'Essay one content.' },
        { id: 'e2', content: 'Essay two content.' },
      ],
      challengerPromptOverride: 'CHALLENGER PROMPT',
    };

    const result = await runEvalCore(deps, input);

    expect(result).toHaveProperty('verdict');
    expect(result.verdict).toHaveProperty('pass');
    expect(result.verdict).toHaveProperty('reasons');
    expect(Array.isArray(result.verdict.reasons)).toBe(true);
    expect(result).toHaveProperty('failedJudges');
    expect(Array.isArray(result.failedJudges)).toBe(true);
    expect(result).toHaveProperty('routedCount');

    expect(deps.writeItem).toHaveBeenCalledTimes(2);

    // generate called incumbent (no override) + challenger (with override) per essay
    expect(deps.generate).toHaveBeenCalledTimes(4);
    const generateMock = deps.generate as ReturnType<typeof vi.fn>;
    expect(generateMock.mock.calls[0][2]).toBeUndefined();
    expect(generateMock.mock.calls[1][2]).toBe('CHALLENGER PROMPT');

    // progress is monotonic and ends at total (2)
    const doneValues = (deps.writeProgress as ReturnType<typeof vi.fn>).mock.calls.map(
      (call: unknown[]) => (call[0] as { done: number }).done
    );
    expect(doneValues.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < doneValues.length; i++) {
      expect(doneValues[i]).toBeGreaterThanOrEqual(doneValues[i - 1]);
    }
    expect(doneValues[0]).toBe(0);
    expect(doneValues[doneValues.length - 1]).toBe(2);
  });

  it('routes an item when the panel disagrees (forced-disagreement verdict), even with a low rand()', async () => {
    // judge 'a' always votes A, judge 'b' always votes B on every pairwise call
    // (both AB and BA orders) => no majority forms => disagreement: true.
    const judges = [mockJudge('a', 'A'), mockJudge('b', 'B')];
    const deps = makeDeps({ judges, rand: () => 0.99 });
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [{ id: 'e1', content: 'Essay content.' }],
      challengerPromptOverride: 'CHALLENGER PROMPT',
    };

    await runEvalCore(deps, input);

    expect(deps.writeItem).toHaveBeenCalledTimes(1);
    const writeItemMock = deps.writeItem as ReturnType<typeof vi.fn>;
    const [itemId, item] = writeItemMock.mock.calls[0] as [string, EvalItemDoc];
    expect(itemId).toBe('e1');
    expect(item.disagreement).toBe(true);
    expect(item.routed).toBe(true);
  });

  it('routes an item when rand() falls below the 0.05 sample rate, even without disagreement', async () => {
    const judges = [mockJudge('a', 'A'), mockJudge('b', 'A')];
    const deps = makeDeps({ judges, rand: () => 0.01 });
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [{ id: 'e1', content: 'Essay content.' }],
      challengerPromptOverride: 'CHALLENGER PROMPT',
    };

    await runEvalCore(deps, input);

    const writeItemMock = deps.writeItem as ReturnType<typeof vi.fn>;
    const [, item] = writeItemMock.mock.calls[0] as [string, EvalItemDoc];
    expect(item.disagreement).toBe(false);
    expect(item.routed).toBe(true);
  });

  it('does not route an item with agreement, no position bias, and a high rand()', async () => {
    const judges = [mockJudge('a', 'A'), mockJudge('b', 'A')];
    const deps = makeDeps({ judges, rand: () => 0.99 });
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [{ id: 'e1', content: 'Essay content.' }],
      challengerPromptOverride: 'CHALLENGER PROMPT',
    };

    await runEvalCore(deps, input);

    const writeItemMock = deps.writeItem as ReturnType<typeof vi.fn>;
    const [, item] = writeItemMock.mock.calls[0] as [string, EvalItemDoc];
    expect(item.routed).toBe(false);
  });

  it('collects the union of failedJudges across items', async () => {
    const judgeA = mockJudge('good', 'A');
    const badJudge1 = mockJudge('bad-1', 'A');
    const badJudge2 = mockJudge('bad-2', 'A');
    // On the first essay, bad-1 fails; on the second, bad-2 fails.
    let callCount = 0;
    (badJudge1.judgeDimensional as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) throw new Error('transient failure');
      return {
        dimensions: {
          correctness: { score: 4, rationale: '' },
          coverage: { score: 3, rationale: '' },
          falsePositiveRestraint: { score: 4, rationale: '' },
          fixGuidance: { score: 3, rationale: '' },
        },
      };
    });
    let call2Count = 0;
    (badJudge2.judgeDimensional as ReturnType<typeof vi.fn>).mockImplementation(async () => {
      call2Count++;
      if (call2Count > 2) throw new Error('transient failure');
      return {
        dimensions: {
          correctness: { score: 4, rationale: '' },
          coverage: { score: 3, rationale: '' },
          falsePositiveRestraint: { score: 4, rationale: '' },
          fixGuidance: { score: 3, rationale: '' },
        },
      };
    });

    const deps = makeDeps({ judges: [judgeA, badJudge1, badJudge2] });
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [
        { id: 'e1', content: 'Essay one.' },
        { id: 'e2', content: 'Essay two.' },
      ],
      challengerPromptOverride: 'OVERRIDE',
    };

    const result = await runEvalCore(deps, input);
    expect(result.failedJudges.sort()).toEqual(['bad-1', 'bad-2']);
  });
});

describe('validateEvalInput', () => {
  const base = {
    report: 'grammar' as const,
    essays: [{ id: 'e1', content: 'x' }],
    challengerPromptOverride: 'override text',
  };

  it('accepts a valid input', () => {
    expect(() => validateEvalInput(base)).not.toThrow();
  });

  it('rejects more than 20 essays, naming the 20 cap', () => {
    const essays = Array.from({ length: 21 }, (_, i) => ({ id: `e${i}`, content: 'x' }));
    expect(() => validateEvalInput({ ...base, essays })).toThrow(/20/);
  });

  it('rejects zero essays', () => {
    expect(() => validateEvalInput({ ...base, essays: [] })).toThrow();
  });

  it('rejects an invalid report kind', () => {
    expect(() => validateEvalInput({ ...base, report: 'bogus' as any })).toThrow(/report/i);
  });

  it('rejects an empty challengerPromptOverride', () => {
    expect(() => validateEvalInput({ ...base, challengerPromptOverride: '' })).toThrow(/override/i);
  });

  it('rejects a whitespace-only challengerPromptOverride', () => {
    expect(() => validateEvalInput({ ...base, challengerPromptOverride: '   ' })).toThrow(/override/i);
  });
});
