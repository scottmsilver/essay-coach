import { describe, it, expect, vi } from 'vitest';
import type { Judge } from '../../shared/panel/types';

// Mocks for makeFirestoreGenerate's 'overall' branch (buildEvaluationPrompt +
// evaluateWithGemini), used only by the makeFirestoreGenerate describe block
// below to verify content-keyed metadata lookup without hitting the network.
// vi.mock calls are hoisted above imports by vitest, so these apply before
// '../src/evalRun' (which imports both) is loaded.
vi.mock('../src/prompt', () => ({
  buildEvaluationPrompt: vi.fn((args: { assignmentPrompt: string; writingType: string; content: string }) => args),
}));
vi.mock('../src/gemini', () => ({
  evaluateWithGemini: vi.fn(async (_apiKey: string, prompt: unknown) => ({ _promptEcho: prompt, traits: {} })),
}));

import {
  runEvalCore,
  validateEvalInput,
  sanitizeEvalRunError,
  redactEvalError,
  EVAL_RUN_GENERIC_ERROR_MESSAGE,
  makeFirestoreGenerate,
  type EvalDeps,
  type EvalRunInput,
  type EvalItemDoc,
  type EssayWithMeta,
} from '../src/evalRun';

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

    // verdict must also carry the raw metric values (not just the gate's
    // pass/reasons), so evalRuns/{id}.verdict has everything
    // EvalRunDetailPage.tsx needs — deterministic here since both mock
    // judges always prefer 'A' with fixed dimensional scores.
    // winOrTieCount = 0 of 2 essays => challengerWinRate = 0.
    // weightedMean.A === weightedMean.B for every item (identical judge
    // scores regardless of AB/BA order) => feedbackDelta = 0.
    // No item has disagreement: true => reliability = 1.
    expect(result.verdict.challengerWinRate).toBe(0);
    expect(result.verdict.feedbackDelta).toBe(0);
    expect(result.verdict.reliability).toBe(1);

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

describe('sanitizeEvalRunError', () => {
  it('never surfaces raw error detail, even when the message embeds key material', async () => {
    // Simulates a Gemini SDK error whose message embeds the API key in the
    // request URL (`?key=...`), which is how startEvalRun's catch block
    // could otherwise leak a secret into the evalRuns doc / HttpsError.
    const secretError = new Error(
      'Gemini request failed: https://generativelanguage.googleapis.com/v1/models/foo:generateContent?key=AIzaSECRET'
    );

    // Exercise the same failure path runEvalCore drives in production: a
    // deps.generate() throw propagating out of the essay loop.
    const deps: EvalDeps = {
      generate: vi.fn(async () => {
        throw secretError;
      }),
      judges: [],
      writeProgress: vi.fn(async () => {}),
      writeItem: vi.fn(async () => {}),
    };
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [{ id: 'e1', content: 'Essay content.' }],
      challengerPromptOverride: 'OVERRIDE',
    };

    let caught: unknown;
    try {
      await runEvalCore(deps, input);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBe(secretError);

    // This is what startEvalRun's catch block does with the caught error
    // before writing runDoc.errorMessage / throwing the HttpsError.
    const safeMessage = sanitizeEvalRunError(caught);
    expect(safeMessage).not.toContain('AIzaSECRET');
    expect(safeMessage).toBe(EVAL_RUN_GENERIC_ERROR_MESSAGE);
  });
});

describe('redactEvalError', () => {
  it('redacts a Gemini-style ?key=... query param', () => {
    const detail =
      'Gemini request failed: https://generativelanguage.googleapis.com/v1/models/foo:generateContent?key=AIzaXXXXREALSECRETXXXX';
    const redacted = redactEvalError(detail);
    expect(redacted).not.toContain('AIzaXXXXREALSECRETXXXX');
    expect(redacted).toContain('?key=[REDACTED]');
  });

  it('redacts an sk-... style API key embedded anywhere in the message', () => {
    const detail = 'OpenAI error: invalid api key sk-abc123def456ghi789';
    const redacted = redactEvalError(detail);
    expect(redacted).not.toContain('sk-abc123def456ghi789');
    expect(redacted).toContain('[REDACTED]');
  });

  it('redacts a bare AIza... key even without a ?key= prefix', () => {
    const detail = 'key material leaked: AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345';
    const redacted = redactEvalError(detail);
    expect(redacted).not.toContain('AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ012345');
  });

  it('redacts the token immediately following an Authorization: header label', () => {
    // Matches the spec's `(authorization\s*[:=]\s*)\S+` pattern, which
    // redacts the single whitespace-delimited token right after the label
    // (e.g. a raw bearer token value assigned as `Authorization: <token>`).
    const detail = 'Request failed, headers: { Authorization: eyJhbGciOiJIUzI1NiJ9.secret.sig }';
    const redacted = redactEvalError(detail);
    expect(redacted).not.toContain('eyJhbGciOiJIUzI1NiJ9.secret.sig');
    expect(redacted.toLowerCase()).toContain('authorization: [redacted]');
  });

  it('leaves ordinary error text untouched', () => {
    const detail = 'Essay 5 not found';
    expect(redactEvalError(detail)).toBe(detail);
  });
});

describe('makeFirestoreGenerate', () => {
  it('resolves per-essay metadata by content, not by call order', async () => {
    // Two essays with distinct metadata. If the generate() closure recovered
    // metadata from a call-order/index cursor (the old behavior), calling it
    // out of the "incumbent then challenger, in essay order" pattern — e.g.
    // essay 2 twice before essay 1 is ever seen — would silently attach the
    // wrong essay's assignmentPrompt/writingType. Keying by content instead
    // makes the result depend only on the content argument, not call order.
    const essays: EssayWithMeta[] = [
      { id: 'e1', content: 'Essay one content.', assignmentPrompt: 'Prompt ONE', writingType: 'narrative' },
      { id: 'e2', content: 'Essay two content.', assignmentPrompt: 'Prompt TWO', writingType: 'argumentative' },
    ];

    const generate = makeFirestoreGenerate({ report: 'overall', essays, apiKey: 'fake-key' });

    // Deliberately out-of-order / repeated calls relative to essays' array
    // order: essay 2 twice, then essay 1. A call-order cursor (essayIndex =
    // floor(callIndex / 2)) would map these three calls to essays[0],
    // essays[0], essays[1] — i.e. every call but the first would get the
    // wrong essay's metadata.
    const first = await generate('overall', 'Essay two content.');
    const second = await generate('overall', 'Essay two content.');
    const third = await generate('overall', 'Essay one content.');

    const firstArgs = JSON.parse(first.feedback)._promptEcho;
    const secondArgs = JSON.parse(second.feedback)._promptEcho;
    const thirdArgs = JSON.parse(third.feedback)._promptEcho;

    expect(firstArgs.assignmentPrompt).toBe('Prompt TWO');
    expect(secondArgs.assignmentPrompt).toBe('Prompt TWO');
    expect(thirdArgs.assignmentPrompt).toBe('Prompt ONE');
  });

  it('throws a clear error when generate() is called with content that matches no loaded essay', async () => {
    const essays: EssayWithMeta[] = [
      { id: 'e1', content: 'Essay one content.', assignmentPrompt: 'Prompt ONE', writingType: 'narrative' },
    ];
    const generate = makeFirestoreGenerate({ report: 'overall', essays, apiKey: 'fake-key' });

    await expect(generate('overall', 'Content that was never loaded.')).rejects.toThrow(/no essay metadata found/i);
  });
});

describe('validateEvalInput', () => {
  // essays here are essayIds as the real onCall wrapper passes them
  // (validateEvalInput({ report, essays: essayIds, challengerPromptOverride })
  // in startEvalRun) — i.e. an array of string ids, not essay content objects.
  const base = {
    report: 'grammar' as const,
    essays: ['e1'],
    challengerPromptOverride: 'override text',
  };

  it('accepts a valid input', () => {
    expect(() => validateEvalInput(base)).not.toThrow();
  });

  it('rejects more than 20 essays, naming the 20 cap', () => {
    const essays = Array.from({ length: 21 }, (_, i) => `e${i}`);
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

  it('rejects a non-string element in essays, naming its index', () => {
    expect(() => validateEvalInput({ ...base, essays: ['e1', 42 as any, 'e3'] })).toThrow(/index 1/i);
  });

  it('rejects an essay id containing a slash (path-traversal-shaped id), naming its index', () => {
    expect(() => validateEvalInput({ ...base, essays: ['e1', 'a/b'] })).toThrow(/index 1/i);
  });

  it('accepts essay ids made only of letters, numbers, underscore, and hyphen', () => {
    expect(() => validateEvalInput({ ...base, essays: ['abc-123_XYZ'] })).not.toThrow();
  });

  it('rejects a challengerPromptOverride over the 20000-char cap, naming the cap', () => {
    expect(() =>
      validateEvalInput({ ...base, challengerPromptOverride: 'x'.repeat(20001) })
    ).toThrow(/20000/);
  });

  it('accepts a challengerPromptOverride of exactly the 20000-char cap', () => {
    expect(() =>
      validateEvalInput({ ...base, challengerPromptOverride: 'x'.repeat(20000) })
    ).not.toThrow();
  });

  it('accepts a valid input with no challengerLabel (optional field)', () => {
    expect(() => validateEvalInput(base)).not.toThrow();
  });

  it('accepts a valid string challengerLabel within the length cap', () => {
    expect(() => validateEvalInput({ ...base, challengerLabel: 'tighter-grammar-v2' })).not.toThrow();
  });

  it('rejects a non-string challengerLabel', () => {
    expect(() => validateEvalInput({ ...base, challengerLabel: 42 as any })).toThrow(/challengerLabel/i);
  });

  it('rejects a challengerLabel over 200 characters', () => {
    expect(() => validateEvalInput({ ...base, challengerLabel: 'x'.repeat(201) })).toThrow(/challengerLabel/i);
  });

  it('accepts a challengerLabel of exactly 200 characters', () => {
    expect(() => validateEvalInput({ ...base, challengerLabel: 'x'.repeat(200) })).not.toThrow();
  });
});
