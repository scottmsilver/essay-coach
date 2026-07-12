import { describe, it, expect, vi, beforeEach } from 'vitest';
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

// Mocks for the startEvalRun onCall wrapper describe block below (mirrors
// submitEssay.test.ts's pattern). onCall is a passthrough so the handler can
// be invoked directly; HttpsError keeps a `.code` field so both these tests
// and resolveChallengerGeneration's tests above (which throw the real
// HttpsError from src/evalRun.ts, constructed against this same mock) can
// assert on it. defineSecret's returned `.value()` is driven by
// mockSecretValues, keyed by the exact secret name each defineSecret(...)
// call in src/evalRun.ts uses (GEMINI_API_KEY / OPENAI_API_KEY /
// ANTHROPIC_API_KEY / OPENROUTER_API_KEY).
const mockSecretValues: Record<string, string> = {
  GEMINI_API_KEY: 'fake-gemini-key',
  OPENAI_API_KEY: 'fake-openai-key',
  ANTHROPIC_API_KEY: 'fake-anthropic-key',
  OPENROUTER_API_KEY: 'fake-openrouter-key',
};

vi.mock('firebase-functions/v2/https', () => ({
  onCall: (_opts: any, handler: any) => handler,
  HttpsError: class HttpsError extends Error {
    constructor(public code: string, message: string) { super(message); }
  },
}));

vi.mock('firebase-functions/v2', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}));

vi.mock('firebase-functions/params', () => ({
  defineSecret: (name: string) => ({ value: () => mockSecretValues[name] }),
}));

const mockAllowlistGet = vi.fn();
const mockAdminsGet = vi.fn();
const mockEssayDocGet = vi.fn();
const mockRunDocSet = vi.fn().mockResolvedValue(undefined);
const mockRunDoc = vi.fn(() => ({
  id: 'run123',
  set: mockRunDocSet,
  update: vi.fn().mockResolvedValue(undefined),
  collection: () => ({ doc: () => ({ set: vi.fn().mockResolvedValue(undefined) }) }),
}));

vi.mock('firebase-admin/firestore', () => ({
  getFirestore: () => ({
    doc: (path: string) => {
      if (path === 'config/allowlist') return { get: mockAllowlistGet };
      if (path === 'config/admins') return { get: mockAdminsGet };
      // users/{uid}/essays/{essayId} — only reached if the fail-closed
      // OpenRouter check below doesn't skip essay loading as intended.
      return {
        get: mockEssayDocGet,
        collection: () => ({ where: () => ({ limit: () => ({ get: vi.fn() }) }) }),
      };
    },
    collection: (name: string) => {
      if (name === 'evalRuns') return { doc: mockRunDoc };
      return { doc: vi.fn() };
    },
  }),
  FieldValue: { serverTimestamp: () => 'SERVER_TIMESTAMP' },
}));

import {
  runEvalCore,
  validateEvalInput,
  sanitizeEvalRunError,
  redactEvalError,
  resolveChallengerGeneration,
  OPENROUTER_MODEL_PREFIX,
  EVAL_RUN_GENERIC_ERROR_MESSAGE,
  makeFirestoreGenerate,
  startEvalRun,
  type EvalDeps,
  type EvalRunInput,
  type EvalItemDoc,
  type EssayWithMeta,
} from '../src/evalRun';
import { evaluateWithGemini } from '../src/gemini';

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
    expect(generateMock.mock.calls[1][2]).toEqual({ promptOverride: 'CHALLENGER PROMPT', modelOverride: undefined });

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

  it('model-only challenger: incumbent call gets no third argument, challenger call gets {modelOverride} with promptOverride undefined', async () => {
    const deps = makeDeps();
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [{ id: 'e1', content: 'Essay one content.' }],
      challengerModelOverride: 'gemini-3.5-flash',
    };

    await runEvalCore(deps, input);

    const generateMock = deps.generate as ReturnType<typeof vi.fn>;
    expect(generateMock.mock.calls[0][2]).toBeUndefined();
    expect(generateMock.mock.calls[1][2]).toEqual({ promptOverride: undefined, modelOverride: 'gemini-3.5-flash' });
  });

  it('both overrides: challenger call receives both promptOverride and modelOverride', async () => {
    const deps = makeDeps();
    const input: EvalRunInput = {
      report: 'grammar',
      essays: [{ id: 'e1', content: 'Essay one content.' }],
      challengerPromptOverride: 'CHALLENGER PROMPT',
      challengerModelOverride: 'gemini-3.5-flash',
    };

    await runEvalCore(deps, input);

    const generateMock = deps.generate as ReturnType<typeof vi.fn>;
    expect(generateMock.mock.calls[0][2]).toBeUndefined();
    expect(generateMock.mock.calls[1][2]).toEqual({
      promptOverride: 'CHALLENGER PROMPT',
      modelOverride: 'gemini-3.5-flash',
    });
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

  it('for "overall", a challenger generateJson takes precedence over modelOverride: evaluateWithGemini gets generateJson in opts and an undefined model', async () => {
    const essays: EssayWithMeta[] = [
      { id: 'e1', content: 'Essay one content.', assignmentPrompt: 'Prompt ONE', writingType: 'narrative' },
    ];
    const generate = makeFirestoreGenerate({ report: 'overall', essays, apiKey: 'fake-key' });
    const fakeGenerateJson = vi.fn(async () => '{}');

    await generate('overall', 'Essay one content.', {
      promptOverride: 'CHALLENGER PROMPT',
      modelOverride: 'openrouter/anthropic/claude-x',
      generateJson: fakeGenerateJson,
    });

    const mockEvaluate = evaluateWithGemini as unknown as ReturnType<typeof vi.fn>;
    const lastCall = mockEvaluate.mock.calls[mockEvaluate.mock.calls.length - 1];
    // evaluateWithGemini(apiKey, prompt, progressRef, model, opts)
    const [, , , model, opts] = lastCall;
    expect(model).toBeUndefined();
    expect(opts).toMatchObject({ systemPromptOverride: 'CHALLENGER PROMPT', generateJson: fakeGenerateJson });
  });

  it('for "overall", modelOverride still reaches evaluateWithGemini when no generateJson is present', async () => {
    const essays: EssayWithMeta[] = [
      { id: 'e1', content: 'Essay one content.', assignmentPrompt: 'Prompt ONE', writingType: 'narrative' },
    ];
    const generate = makeFirestoreGenerate({ report: 'overall', essays, apiKey: 'fake-key' });

    await generate('overall', 'Essay one content.', { modelOverride: 'gemini-3.5-flash' });

    const mockEvaluate = evaluateWithGemini as unknown as ReturnType<typeof vi.fn>;
    const lastCall = mockEvaluate.mock.calls[mockEvaluate.mock.calls.length - 1];
    const [, , , model] = lastCall;
    expect(model).toBe('gemini-3.5-flash');
  });
});

describe('resolveChallengerGeneration', () => {
  it('passes non-openrouter model overrides through unchanged, with no generateJson', () => {
    const result = resolveChallengerGeneration('gemini-3.5-flash', 'sk-or-should-be-unused');
    expect(result).toEqual({ modelOverride: 'gemini-3.5-flash' });
  });

  it('passes undefined through unchanged when no model override was given', () => {
    const result = resolveChallengerGeneration(undefined, 'sk-or-some-key');
    expect(result).toEqual({ modelOverride: undefined });
  });

  it('builds a generateJson and clears modelOverride for an openrouter/-prefixed override when the secret is set', () => {
    const result = resolveChallengerGeneration(`${OPENROUTER_MODEL_PREFIX}anthropic/claude-x`, 'sk-or-realkey');
    expect(result.modelOverride).toBeUndefined();
    expect(typeof result.generateJson).toBe('function');
  });

  it('throws HttpsError(failed-precondition) naming OPENROUTER_API_KEY when the secret is unset for an openrouter/-prefixed override', () => {
    let caught: any;
    try {
      resolveChallengerGeneration(`${OPENROUTER_MODEL_PREFIX}anthropic/claude-x`, '');
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('failed-precondition');
    expect(caught.message).toContain('OPENROUTER_API_KEY');
  });

  it('throws the same error when the secret value is undefined', () => {
    let caught: any;
    try {
      resolveChallengerGeneration(`${OPENROUTER_MODEL_PREFIX}anthropic/claude-x`, undefined);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    expect(caught.code).toBe('failed-precondition');
    expect(caught.message).toContain('OPENROUTER_API_KEY');
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

  it('rejects an empty challengerPromptOverride (and no model override to fall back on)', () => {
    expect(() => validateEvalInput({ ...base, challengerPromptOverride: '' })).toThrow(/override/i);
  });

  it('rejects a whitespace-only challengerPromptOverride (and no model override to fall back on)', () => {
    expect(() => validateEvalInput({ ...base, challengerPromptOverride: '   ' })).toThrow(/override/i);
  });

  it('rejects when neither challengerPromptOverride nor challengerModelOverride is provided', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'] })
    ).toThrow('Provide a challenger prompt override, a challenger model override, or both.');
  });

  it('accepts a model-only input with no challengerPromptOverride at all', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'gemini-3.5-flash' })
    ).not.toThrow();
  });

  it('accepts an input with both a challengerPromptOverride and a challengerModelOverride', () => {
    expect(() =>
      validateEvalInput({ ...base, challengerModelOverride: 'gemini-3.5-flash' })
    ).not.toThrow();
  });

  it('rejects a malformed challengerModelOverride, naming the field', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'bad model!' })
    ).toThrow(/challengerModelOverride/);
  });

  it('rejects a non-string challengerModelOverride, naming the field', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 42 as any })
    ).toThrow(/challengerModelOverride/);
  });

  it('accepts a challengerModelOverride made of letters, numbers, dots, underscores, colons, and hyphens', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'gemini-3.5_flash.preview:v2' })
    ).not.toThrow();
  });

  it('rejects a challengerModelOverride over 120 characters', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'x'.repeat(121) })
    ).toThrow(/challengerModelOverride/);
  });

  it('accepts a challengerModelOverride of exactly 120 characters', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'x'.repeat(120) })
    ).not.toThrow();
  });

  it('accepts an openrouter/vendor/model challengerModelOverride', () => {
    expect(() =>
      validateEvalInput({
        report: 'grammar',
        essays: ['e1'],
        challengerModelOverride: 'openrouter/anthropic/claude-x',
      })
    ).not.toThrow();
  });

  it('rejects an empty middle segment (a//b), naming the field', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'a//b' })
    ).toThrow(/challengerModelOverride/);
  });

  it('rejects a bare "openrouter/" with no model segment, naming the field', () => {
    expect(() =>
      validateEvalInput({ report: 'grammar', essays: ['e1'], challengerModelOverride: 'openrouter/' })
    ).toThrow(/challengerModelOverride/);
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

describe('startEvalRun (onCall wrapper)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSecretValues.GEMINI_API_KEY = 'fake-gemini-key';
    mockSecretValues.OPENAI_API_KEY = 'fake-openai-key';
    mockSecretValues.ANTHROPIC_API_KEY = 'fake-anthropic-key';
    mockAllowlistGet.mockResolvedValue({ exists: true, data: () => ({ emails: ['test@gmail.com'] }) });
    mockAdminsGet.mockResolvedValue({ exists: true, data: () => ({ emails: ['test@gmail.com'] }) });
    mockRunDocSet.mockResolvedValue(undefined);
  });

  const authedRequest = (data: Record<string, unknown>) => ({
    auth: { uid: 'u1', token: { email: 'test@gmail.com' } },
    data,
  });

  // Regression test for the bug this task fixes: resolveChallengerGeneration()
  // used to run AFTER the evalRuns/{id} doc was created with status
  // 'generating', outside the try/catch that flips it to 'error' — so an
  // openrouter/-prefixed model with a missing OPENROUTER_API_KEY threw
  // failed-precondition and stranded the run doc in 'generating' forever.
  // It's now hoisted to right after validateEvalInput, before any Firestore
  // reads/writes, so this path must reject WITHOUT ever creating a run doc
  // (and, as a bonus consequence of the hoist, without reading essays either).
  it('rejects with failed-precondition and creates no run doc when an openrouter/ model is used with an empty OPENROUTER_API_KEY', async () => {
    mockSecretValues.OPENROUTER_API_KEY = '';

    let caught: any;
    try {
      await (startEvalRun as any)(
        authedRequest({
          report: 'overall',
          essayIds: ['essay1'],
          challengerModelOverride: `${OPENROUTER_MODEL_PREFIX}anthropic/claude-3-opus`,
        })
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('failed-precondition');
    expect(caught.message).toContain('OPENROUTER_API_KEY');

    // The whole point of the fix: no evalRuns/{id} doc ever gets created (and
    // hence never gets stranded in 'generating').
    expect(mockRunDocSet).not.toHaveBeenCalled();
    // Bonus: the fail-closed check now runs before essay loading too, so the
    // per-essay Firestore reads never happen on this path either.
    expect(mockEssayDocGet).not.toHaveBeenCalled();
  });

  it('rejects the same way when OPENROUTER_API_KEY is undefined rather than empty-string', async () => {
    delete mockSecretValues.OPENROUTER_API_KEY;

    let caught: any;
    try {
      await (startEvalRun as any)(
        authedRequest({
          report: 'overall',
          essayIds: ['essay1'],
          challengerModelOverride: `${OPENROUTER_MODEL_PREFIX}anthropic/claude-3-opus`,
        })
      );
    } catch (err) {
      caught = err;
    }

    expect(caught).toBeDefined();
    expect(caught.code).toBe('failed-precondition');
    expect(mockRunDocSet).not.toHaveBeenCalled();
    expect(mockEssayDocGet).not.toHaveBeenCalled();
  });
});
