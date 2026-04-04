# Model Evaluation Framework Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Promptfoo-based evaluation framework that compares Gemini model outputs for essay grading, using the real production code path with a parameterized model name.

**Architecture:** Refactor `streamGemini.ts` to accept a model parameter, export `EVALUATION_SCHEMA` from `gemini.ts`, then build an `eval/` directory with a Firestore exporter, calibration dataset builder, custom Promptfoo provider, and Claude-as-judge config. The eval framework calls the same `evaluateWithGemini` function as production, just with a different model name and no Firestore progress tracking.

**Tech Stack:** Promptfoo, TypeScript, `@google/genai`, `firebase-admin`, `@anthropic-ai/sdk` (for Claude judge via Promptfoo)

**Spec:** `docs/superpowers/specs/2026-04-04-model-evaluation-framework-design.md`

---

### Task 1: Parameterize Model in streamGemini.ts

**Files:**
- Modify: `functions/src/streamGemini.ts:4-17` (add model to StreamOptions, use it in generateContentStream)
- Modify: `functions/src/gemini.ts:54-70` (thread model param through evaluateWithGemini, export EVALUATION_SCHEMA)
- Test: `functions/src/streamGemini.test.ts` (new)

This is the prerequisite refactor. Production behavior is unchanged (default model stays `gemini-3.1-pro-preview`). The eval framework will pass a different model name.

- [ ] **Step 1: Write failing test for model parameter**

Create `functions/src/streamGemini.test.ts`:

```typescript
import { describe, it, expect, vi } from 'vitest';

// We'll test that streamGeminiJson passes the model to the SDK.
// Mock @google/genai to capture what model is used.
vi.mock('@google/genai', () => {
  const mockStream = {
    [Symbol.asyncIterator]: async function* () {
      yield {
        candidates: [{
          content: {
            parts: [{ text: '{"test": true}' }],
          },
        }],
      };
    },
  };
  const mockModels = {
    generateContentStream: vi.fn().mockResolvedValue(mockStream),
  };
  return {
    GoogleGenAI: vi.fn().mockImplementation(() => ({ models: mockModels })),
    __mockModels: mockModels,
  };
});

import { streamGeminiJson } from './streamGemini';
import { GoogleGenAI } from '@google/genai';

// Access the mock to inspect calls
const mockConstructor = GoogleGenAI as unknown as ReturnType<typeof vi.fn>;

describe('streamGeminiJson', () => {
  it('uses default model when none specified', async () => {
    await streamGeminiJson({
      apiKey: 'test-key',
      contents: 'test prompt',
      systemInstruction: 'test system',
      responseSchema: {},
      statusField: 'evaluationStatus',
      generatingMessage: 'Testing...',
    });

    const instance = mockConstructor.mock.results[0].value;
    const call = instance.models.generateContentStream.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-pro-preview');
  });

  it('uses custom model when specified', async () => {
    await streamGeminiJson({
      apiKey: 'test-key',
      contents: 'test prompt',
      systemInstruction: 'test system',
      responseSchema: {},
      statusField: 'evaluationStatus',
      generatingMessage: 'Testing...',
      model: 'gemini-3.1-flash-light',
    });

    const instance = mockConstructor.mock.results[1].value;
    const call = instance.models.generateContentStream.mock.calls[0][0];
    expect(call.model).toBe('gemini-3.1-flash-light');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd functions && npx vitest run src/streamGemini.test.ts`
Expected: FAIL — `streamGeminiJson` does not accept a `model` option yet.

- [ ] **Step 3: Add model parameter to StreamOptions and streamGeminiJson**

In `functions/src/streamGemini.ts`, change the hardcoded model to an optional parameter:

```typescript
const DEFAULT_MODEL = 'gemini-3.1-pro-preview';
const PROGRESS_THROTTLE_MS = 2000;

interface StreamOptions {
  apiKey: string;
  contents: string;
  systemInstruction: string;
  responseSchema: Record<string, unknown>;
  progressRef?: DocumentReference;
  /** Firestore field name for status updates (e.g. 'evaluationStatus') */
  statusField: string;
  /** Message shown when Gemini starts writing output */
  generatingMessage: string;
  /** Gemini model name. Defaults to gemini-3.1-pro-preview */
  model?: string;
}
```

And in the `streamGeminiJson` function body, replace the hardcoded `MODEL` reference:

```typescript
  const stream = await ai.models.generateContentStream({
    model: opts.model || DEFAULT_MODEL,
    contents: opts.contents,
```

Remove the old `const MODEL = 'gemini-3.1-pro-preview';` line at the top.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd functions && npx vitest run src/streamGemini.test.ts`
Expected: PASS — both tests green.

- [ ] **Step 5: Thread model parameter through evaluateWithGemini and export EVALUATION_SCHEMA**

In `functions/src/gemini.ts`, make two changes:

First, export the schema:

```typescript
export const EVALUATION_SCHEMA = {
```

(Change `const` to `export const` on line 5.)

Second, add optional `model` parameter to `evaluateWithGemini`:

```typescript
export async function evaluateWithGemini(
  apiKey: string,
  userPrompt: string,
  progressRef?: DocumentReference,
  model?: string,
): Promise<Record<string, unknown>> {
  const outputText = await streamGeminiJson({
    apiKey,
    contents: userPrompt,
    systemInstruction: SYSTEM_PROMPT,
    responseSchema: EVALUATION_SCHEMA,
    progressRef,
    statusField: 'evaluationStatus',
    generatingMessage: 'Writing feedback...',
    model,
  });

  return JSON.parse(outputText);
}
```

- [ ] **Step 6: Verify existing tests still pass**

Run: `cd functions && npx vitest run`
Expected: All existing tests pass. The refactor is backwards-compatible (model defaults to the current value).

- [ ] **Step 7: Update test-evaluate.ts to use shared schema**

In `functions/scripts/test-evaluate.ts`, replace the duplicated schema (lines 110-157) with an import:

```typescript
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../src/prompt';
import { EVALUATION_SCHEMA } from '../src/gemini';
import { GoogleGenAI } from '@google/genai';
```

And in the `generateContent` call config:

```typescript
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: EVALUATION_SCHEMA,
    },
  });
```

- [ ] **Step 8: Verify test-evaluate.ts still works**

Run: `cd functions && npx tsx scripts/test-evaluate.ts --sample`
Expected: Evaluation runs successfully with the shared schema import. (Requires `GEMINI_API_KEY` env var — skip if not available, the import correctness is verified by TypeScript compilation.)

Run: `cd functions && npx tsc --noEmit`
Expected: No type errors.

- [ ] **Step 9: Commit**

```bash
git add functions/src/streamGemini.ts functions/src/gemini.ts functions/src/streamGemini.test.ts functions/scripts/test-evaluate.ts
git commit -m "refactor: parameterize Gemini model name and export EVALUATION_SCHEMA

Model name is now an optional parameter in streamGeminiJson and
evaluateWithGemini (defaults to gemini-3.1-pro-preview). EVALUATION_SCHEMA
is exported from gemini.ts so it can be shared. test-evaluate.ts now
imports the shared schema instead of duplicating it."
```

---

### Task 2: Set Up eval/ Directory and Package

**Files:**
- Create: `eval/package.json`
- Create: `eval/tsconfig.json`
- Modify: `.gitignore` (add eval dataset patterns)

- [ ] **Step 1: Create eval/package.json**

```json
{
  "name": "essay-grader-eval",
  "private": true,
  "type": "module",
  "scripts": {
    "export": "tsx export-firestore.ts",
    "calibration": "tsx build-calibration.ts",
    "eval": "promptfoo eval",
    "view": "promptfoo view"
  },
  "dependencies": {
    "@google/genai": "^1.0.0",
    "firebase-admin": "^13.0.0",
    "promptfoo": "^0.100.0"
  },
  "devDependencies": {
    "tsx": "^4.0.0",
    "typescript": "^5.4.0"
  }
}
```

- [ ] **Step 2: Create eval/tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "es2022",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "outDir": "dist",
    "rootDir": "."
  },
  "include": ["*.ts", "providers/*.ts"],
  "exclude": ["node_modules"]
}
```

- [ ] **Step 3: Add eval dataset patterns to .gitignore**

Append to `.gitignore`:

```
# Eval framework datasets (generated, contain production data)
eval/datasets/
eval/node_modules/
eval/dist/
```

- [ ] **Step 4: Install dependencies**

Run: `cd eval && npm install`
Expected: Clean install, no errors.

- [ ] **Step 5: Commit**

```bash
git add eval/package.json eval/tsconfig.json .gitignore
git commit -m "chore: scaffold eval/ directory with promptfoo deps"
```

---

### Task 3: Build Firestore Exporter

**Files:**
- Create: `eval/export-firestore.ts`

The exporter pulls all production evaluations from Firestore into `eval/datasets/production.json`. Full replace every run. Optional `--from` / `--to` date filters (UTC).

- [ ] **Step 1: Create export-firestore.ts**

```typescript
import { initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const PROJECT_ID = 'essay-grader-83737x';
const OUTPUT_PATH = resolve(dirname(new URL(import.meta.url).pathname), 'datasets/production.json');

// ── Parse args ──────────────────────────────────────────────────────────────

interface ExportArgs {
  from?: Date;
  to?: Date;
}

function parseArgs(): ExportArgs {
  const args = process.argv.slice(2);
  const result: ExportArgs = {};

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from' && args[i + 1]) {
      result.from = new Date(args[++i] + 'T00:00:00Z');
    } else if (args[i] === '--to' && args[i + 1]) {
      result.to = new Date(args[++i] + 'T23:59:59.999Z');
    } else {
      console.error(`Unknown argument: ${args[i]}`);
      console.error('Usage: npx tsx export-firestore.ts [--from YYYY-MM-DD] [--to YYYY-MM-DD]');
      process.exit(1);
    }
  }

  return result;
}

// ── Types ───────────────────────────────────────────────────────────────────

interface ExportedDraft {
  /** Document path for traceability */
  path: string;
  /** Essay content as evaluated by the model */
  content: string;
  /** Assignment prompt from the essay document */
  assignmentPrompt: string;
  /** Writing type (argumentative, narrative, etc.) */
  writingType: string;
  /** Draft number (1 = initial, 2+ = revision) */
  draftNumber: number;
  /** Previous draft's evaluation, for resubmission context. null if draft 1 or previous eval missing */
  previousEvaluation: Record<string, unknown> | null;
  /** The current model's evaluation output (baseline for comparison) */
  evaluation: Record<string, unknown>;
  /** When this draft was submitted (ISO string, UTC) */
  submittedAt: string;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const exportArgs = parseArgs();

  initializeApp({ projectId: PROJECT_ID, credential: applicationDefault() });
  const db = getFirestore();

  const records: ExportedDraft[] = [];
  const users = await db.collection('users').listDocuments();

  console.log(`Exporting from ${PROJECT_ID}...`);
  if (exportArgs.from) console.log(`  From: ${exportArgs.from.toISOString()}`);
  if (exportArgs.to) console.log(`  To: ${exportArgs.to.toISOString()}`);

  for (const userDoc of users) {
    const essays = await db.collection('users').doc(userDoc.id).collection('essays').get();

    for (const essayDoc of essays.docs) {
      const essayData = essayDoc.data();
      const { assignmentPrompt, writingType } = essayData;

      const drafts = await essayDoc.ref.collection('drafts').get();

      // Build a map of draftNumber -> evaluation for previous-eval lookup
      const evalByDraftNumber: Record<number, Record<string, unknown>> = {};
      for (const draftDoc of drafts.docs) {
        const d = draftDoc.data();
        if (d.evaluation && d.draftNumber) {
          evalByDraftNumber[d.draftNumber] = d.evaluation;
        }
      }

      for (const draftDoc of drafts.docs) {
        const draftData = draftDoc.data();

        // Skip drafts without evaluations
        if (!draftData.evaluation) continue;

        // Apply date filters
        const submittedAt: Timestamp | undefined = draftData.submittedAt;
        if (submittedAt) {
          const ts = submittedAt.toDate();
          if (exportArgs.from && ts < exportArgs.from) continue;
          if (exportArgs.to && ts > exportArgs.to) continue;
        }

        // For resubmissions, look up the previous draft's evaluation
        const draftNumber: number = draftData.draftNumber || 1;
        const previousEvaluation = draftNumber > 1
          ? evalByDraftNumber[draftNumber - 1] || null
          : null;

        records.push({
          path: `users/${userDoc.id}/essays/${essayDoc.id}/drafts/${draftDoc.id}`,
          content: draftData.content,
          assignmentPrompt: assignmentPrompt || '',
          writingType: writingType || 'argumentative',
          draftNumber,
          previousEvaluation,
          evaluation: draftData.evaluation,
          submittedAt: submittedAt ? submittedAt.toDate().toISOString() : new Date().toISOString(),
        });
      }
    }
  }

  // Sort by submittedAt for consistent ordering
  records.sort((a, b) => a.submittedAt.localeCompare(b.submittedAt));

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(records, null, 2));

  console.log(`\nExported ${records.length} drafts with evaluations to ${OUTPUT_PATH}`);
  console.log(`  Initial submissions: ${records.filter(r => r.draftNumber === 1).length}`);
  console.log(`  Resubmissions: ${records.filter(r => r.draftNumber > 1).length}`);
  console.log(`  Resubmissions with previous eval: ${records.filter(r => r.previousEvaluation !== null).length}`);
}

main().catch((err) => {
  console.error('Export failed:', err.message || err);
  process.exit(1);
});
```

- [ ] **Step 2: Run the exporter**

Run: `cd eval && npx tsx export-firestore.ts`
Expected: Outputs something like:
```
Exporting from essay-grader-83737x...

Exported 88 drafts with evaluations to .../eval/datasets/production.json
  Initial submissions: N
  Resubmissions: M
  Resubmissions with previous eval: K
```

Verify the output file exists and has content:
Run: `wc -l eval/datasets/production.json && head -20 eval/datasets/production.json`

- [ ] **Step 3: Commit**

```bash
git add eval/export-firestore.ts
git commit -m "feat: add Firestore exporter for eval production dataset"
```

---

### Task 4: Build Calibration Dataset Generator

**Files:**
- Create: `eval/build-calibration.ts`

Parses test essay filenames to extract expected score ranges and produces `eval/datasets/calibration.json`.

- [ ] **Step 1: Create build-calibration.ts**

```typescript
import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';

// ── Config ──────────────────────────────────────────────────────────────────

const TEST_ESSAYS_DIR = resolve(dirname(new URL(import.meta.url).pathname), '../functions/test-essays');
const OUTPUT_PATH = resolve(dirname(new URL(import.meta.url).pathname), 'datasets/calibration.json');

// ── Types ───────────────────────────────────────────────────────────────────

interface CalibrationEssay {
  /** Filename for identification */
  filename: string;
  /** Essay content */
  content: string;
  /** Writing type */
  writingType: string;
  /** Assignment prompt */
  assignmentPrompt: string;
  /** Expected average score range [min, max], or null if no expected score */
  expectedAvgScoreRange: [number, number] | null;
  /** Source of the expected score (e.g., "ACT score 5", "Oregon DOE exceeds") */
  scoreSource: string | null;
}

// ── Score range mappings ────────────────────────────────────────────────────

const OREGON_LEVEL_RANGES: Record<string, [number, number]> = {
  exceeds: [5, 6],
  meets: [3, 5],
  approaching: [2, 4],
  doesnotmeet: [1, 3],
};

/** ACT score N maps to expected average range [N-1, N+1], clamped to 1-6 */
function actScoreRange(n: number): [number, number] {
  return [Math.max(1, n - 1), Math.min(6, n + 1)];
}

// ── Assignment prompts per corpus ────────────────────────────────────────────

const PROMPTS: Record<string, string> = {
  'act-machines': 'Intelligent machines challenge our long-standing ideas about what humans are or can be. Write a unified, coherent essay about what you think about intelligent machines.',
  'oregon-3dprinters': 'Write an argumentative essay about 3D printers, using evidence from the provided sources.',
  'oregon-geocaching': 'Write an informational essay about geocaching, using evidence from the provided sources.',
  'oregon-sunflower': 'Write an informational essay about sunflowers, using evidence from the provided sources.',
  'grade9-civil-disobedience': 'Write an analytical essay examining the concept of civil disobedience.',
  'grade11-marching': 'Write an analytical essay about the text.',
  'grade12-freedom': 'Write an analytical essay about the text.',
  'hayes-letter': 'Write a letter.',
};

// ── Main ────────────────────────────────────────────────────────────────────

function main() {
  const files = readdirSync(TEST_ESSAYS_DIR).filter(f => f.endsWith('.txt')).sort();
  const essays: CalibrationEssay[] = [];

  for (const filename of files) {
    const content = readFileSync(resolve(TEST_ESSAYS_DIR, filename), 'utf-8');
    const name = basename(filename, '.txt');

    let writingType = 'argumentative';
    let assignmentPrompt = '';
    let expectedAvgScoreRange: [number, number] | null = null;
    let scoreSource: string | null = null;

    // ACT essays: act-machines-score{N}
    const actMatch = name.match(/^act-machines-score(\d)$/);
    if (actMatch) {
      const n = parseInt(actMatch[1], 10);
      expectedAvgScoreRange = actScoreRange(n);
      scoreSource = `ACT score ${n}`;
      assignmentPrompt = PROMPTS['act-machines'];
      writingType = 'argumentative';
    }

    // Oregon DOE essays: oregon-{topic}-{letter}-{level}
    const oregonMatch = name.match(/^oregon-(\w+)-[A-D]-(\w+)$/);
    if (oregonMatch) {
      const topic = oregonMatch[1];
      const level = oregonMatch[2];
      expectedAvgScoreRange = OREGON_LEVEL_RANGES[level] || null;
      scoreSource = `Oregon DOE ${level}`;
      assignmentPrompt = PROMPTS[`oregon-${topic}`] || `Write about ${topic}.`;
      writingType = topic === '3dprinters' ? 'argumentative' : 'expository';
    }

    // Grade-level essays: no expected score
    const gradeMatch = name.match(/^grade(\d+)/);
    if (gradeMatch) {
      assignmentPrompt = PROMPTS[name] || PROMPTS[name.replace(/-.*/, '')] || 'Write an analytical essay.';
      writingType = 'analytical';
      scoreSource = null;
      expectedAvgScoreRange = null;
    }

    // hayes-letter: no expected score
    if (name === 'hayes-letter') {
      assignmentPrompt = PROMPTS['hayes-letter'];
      writingType = 'narrative';
      scoreSource = null;
      expectedAvgScoreRange = null;
    }

    essays.push({
      filename,
      content,
      writingType,
      assignmentPrompt,
      expectedAvgScoreRange,
      scoreSource,
    });
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(essays, null, 2));

  console.log(`Generated ${essays.length} calibration essays to ${OUTPUT_PATH}`);
  console.log(`  With expected scores: ${essays.filter(e => e.expectedAvgScoreRange).length}`);
  console.log(`  Without expected scores: ${essays.filter(e => !e.expectedAvgScoreRange).length}`);
}

main();
```

- [ ] **Step 2: Run the calibration builder**

Run: `cd eval && npx tsx build-calibration.ts`
Expected:
```
Generated 22 calibration essays to .../eval/datasets/calibration.json
  With expected scores: 18
  Without expected scores: 4
```

- [ ] **Step 3: Commit**

```bash
git add eval/build-calibration.ts
git commit -m "feat: add calibration dataset builder from test essays"
```

---

### Task 5: Create Custom Promptfoo Provider

**Files:**
- Create: `eval/providers/gemini-essay-grader.ts`

This provider calls the real `evaluateWithGemini` from `functions/src/gemini.ts`, passing through the model name from Promptfoo's provider config.

- [ ] **Step 1: Create the custom provider**

```typescript
import { buildEvaluationPrompt, buildResubmissionPrompt } from '../../functions/src/prompt.js';
import { evaluateWithGemini } from '../../functions/src/gemini.js';

import type { ApiProvider, ProviderResponse, CallApiContextParams } from 'promptfoo';

/**
 * Custom Promptfoo provider that calls the real evaluateWithGemini function.
 *
 * Promptfoo passes the essay content as the prompt. The provider reads
 * structured metadata (assignmentPrompt, writingType, etc.) from the
 * test case vars to build the correct evaluation prompt.
 *
 * Provider config in promptfooconfig.yaml:
 *   providers:
 *     - id: "file://providers/gemini-essay-grader.ts"
 *       config:
 *         model: "gemini-3.1-flash-light"
 */
class GeminiEssayGraderProvider implements ApiProvider {
  private model: string;

  constructor(options: { id?: string; config?: Record<string, unknown> } = {}) {
    this.model = (options.config?.model as string) || 'gemini-3.1-pro-preview';
  }

  id(): string {
    return `gemini-essay-grader:${this.model}`;
  }

  async callApi(
    prompt: string,
    context?: CallApiContextParams,
  ): Promise<ProviderResponse> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return { error: 'GEMINI_API_KEY env var is required' };
    }

    const vars = context?.vars || {};
    const assignmentPrompt = vars.assignmentPrompt as string || '';
    const writingType = vars.writingType as string || 'argumentative';
    const content = vars.content as string || prompt;
    const draftNumber = vars.draftNumber as number || 1;
    const previousEvaluation = vars.previousEvaluation as Record<string, unknown> | null || null;

    // Build the prompt the same way production does
    let evalPrompt: string;
    if (draftNumber > 1 && previousEvaluation) {
      evalPrompt = buildResubmissionPrompt({
        assignmentPrompt,
        writingType,
        content,
        previousEvaluation: JSON.stringify(previousEvaluation),
      });
    } else {
      evalPrompt = buildEvaluationPrompt({
        assignmentPrompt,
        writingType,
        content,
      });
    }

    const startTime = Date.now();
    try {
      // Call the real production function with model parameter, no progressRef
      const result = await evaluateWithGemini(apiKey, evalPrompt, undefined, this.model);
      const latencyMs = Date.now() - startTime;

      return {
        output: JSON.stringify(result),
        tokenUsage: {}, // Promptfoo tracks this from the provider if available
        cost: undefined, // Let Promptfoo estimate from model name
        metadata: { latencyMs, model: this.model },
      };
    } catch (err) {
      const latencyMs = Date.now() - startTime;
      return {
        error: err instanceof Error ? err.message : String(err),
        metadata: { latencyMs, model: this.model },
      };
    }
  }
}

export default GeminiEssayGraderProvider;
```

- [ ] **Step 2: Verify TypeScript compiles**

Run: `cd eval && npx tsc --noEmit`
Expected: No type errors. (The imports from `../../functions/src/` should resolve.)

If there are module resolution issues between the functions CJS config and eval's ESM config, adjust the import paths. The functions code uses `module: "commonjs"` — the provider may need to import from the compiled output at `../../functions/lib/functions/src/` instead. Check and fix.

- [ ] **Step 3: Commit**

```bash
git add eval/providers/gemini-essay-grader.ts
git commit -m "feat: add custom Promptfoo provider wrapping real evaluateWithGemini"
```

---

### Task 6: Create Claude-as-Judge Configuration

**Files:**
- Create: `eval/judges/feedback-quality.yaml`

The judge prompt evaluates feedback on specificity and actionability, and annotations on Socratic tone.

- [ ] **Step 1: Create the judge prompt file**

Create `eval/judges/feedback-quality.yaml`:

```yaml
# Claude-as-judge for essay feedback quality.
# Used by Promptfoo's llm-rubric assertion.
#
# The judge evaluates each trait's output on three dimensions:
# - Specificity (feedback): does it reference concrete essay details?
# - Actionability (feedback): can the student act on it without being told what to write?
# - Socratic tone (annotations): do annotations guide through questions, not dictate?

prompt: |
  You are evaluating the quality of essay feedback produced by an AI writing coach.
  You will see the student's essay, a specific writing trait being evaluated, and the
  AI coach's feedback and annotations for that trait.

  Rate the feedback on these three dimensions, each scored 1-5:

  ## Specificity (applies to the feedback text)
  Does the feedback reference concrete details from this specific essay?
  - 1: Completely generic, could apply to any essay ("Your thesis is weak")
  - 3: References the essay's topic but not specific passages or details
  - 5: Points to exact passages, quotes, or structural elements ("Your thesis claims X but paragraph 2 shifts to Y without connecting them")

  ## Actionability (applies to the feedback text and revision suggestions)
  Can the student act on this feedback without being told what to write?
  - 1: Vague encouragement or criticism with no direction ("Try harder", "Needs work")
  - 3: Identifies what to improve but not how ("Add more evidence")
  - 5: Gives a clear, specific next step the student can take ("Find three places where you make a claim and add a specific statistic or quote to support each one")

  ## Socratic Tone (applies ONLY to the annotations array)
  Do the annotations guide through questions rather than dictate or rewrite?
  - 1: Rewrites the student's text or provides replacement sentences
  - 3: Identifies problems but tells rather than asks ("This is too vague")
  - 5: Asks questions that lead the student to discover the issue ("If a skeptic challenged this claim, what specific evidence would you point to?")

  Note on feedback tone: The coaching system uses different tones for different score
  levels (collegial for scores 5-6, coaching for 3, supportive for 1-2). Do NOT penalize
  appropriate tone variation. Only judge the three dimensions above.

  ---

  ESSAY:
  {{essay_content}}

  TRAIT: {{trait_name}}

  FEEDBACK: {{feedback_text}}

  ANNOTATIONS:
  {{annotations_json}}

  ---

  Respond with a JSON object:
  {
    "specificity": { "score": <1-5>, "rationale": "<one sentence>" },
    "actionability": { "score": <1-5>, "rationale": "<one sentence>" },
    "socratic_tone": { "score": <1-5>, "rationale": "<one sentence>" }
  }
```

- [ ] **Step 2: Commit**

```bash
git add eval/judges/feedback-quality.yaml
git commit -m "feat: add Claude-as-judge prompt for feedback quality scoring"
```

---

### Task 7: Create Promptfoo Configuration

**Files:**
- Create: `eval/promptfooconfig.yaml`

This is the main configuration that ties together providers, datasets, assertions, and the judge.

- [ ] **Step 1: Create promptfooconfig.yaml**

```yaml
# Model Evaluation Framework
# Compares essay grading quality across Gemini models.
#
# Usage:
#   cd eval
#   GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npx promptfoo eval
#   npx promptfoo view

description: "Essay Grader Model Evaluation"

providers:
  - id: "file://providers/gemini-essay-grader.ts"
    label: "gemini-3.1-pro-preview (incumbent)"
    config:
      model: "gemini-3.1-pro-preview"

  - id: "file://providers/gemini-essay-grader.ts"
    label: "gemini-3.1-flash-light (challenger)"
    config:
      model: "gemini-3.1-flash-light"

# The prompt template. Promptfoo sends this to the provider's callApi method.
# The provider ignores the raw prompt and uses vars to build the real evaluation prompt.
prompts:
  - "Evaluate this essay: {{content}}"

# Test cases from both datasets
tests: "file://tests.ts"

# Default assertions applied to every test case
defaultTest:
  options:
    provider:
      anthropic:
        modelName: "claude-sonnet-4-6"
  assert:
    # 1. Valid JSON response
    - type: is-json

    # 2. Structural validation (score range, required fields, annotation count)
    - type: javascript
      value: |
        const evaluation = JSON.parse(output);
        const traits = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
        const errors = [];

        // All traits present
        for (const t of traits) {
          if (!evaluation.traits?.[t]) {
            errors.push(`Missing trait: ${t}`);
            continue;
          }
          const trait = evaluation.traits[t];

          // Score is integer 1-6
          if (!Number.isInteger(trait.score) || trait.score < 1 || trait.score > 6) {
            errors.push(`${t}: score ${trait.score} not integer 1-6`);
          }

          // Annotations array exists with 2-4 items
          if (!Array.isArray(trait.annotations)) {
            errors.push(`${t}: annotations not an array`);
          } else if (trait.annotations.length < 1 || trait.annotations.length > 6) {
            // Soft check: warn but don't fail for 1 or 5-6 annotations
            if (trait.annotations.length < 1) {
              errors.push(`${t}: no annotations`);
            }
          }

          // revisionPriority null for scores >= 4
          if (trait.score >= 4 && trait.revisionPriority !== null) {
            // Soft check: could be valid for critical traits, just note it
          }
        }

        // Required top-level fields
        if (typeof evaluation.overallFeedback !== 'string') errors.push('Missing overallFeedback');
        if (!Array.isArray(evaluation.revisionPlan)) errors.push('Missing revisionPlan');

        return {
          pass: errors.length === 0,
          score: 1 - (errors.length / 20),
          reason: errors.length === 0 ? 'Schema valid' : errors.join('; '),
        };
```

- [ ] **Step 2: Create tests.ts that loads both datasets**

Create `eval/tests.ts`:

```typescript
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestCase {
  description: string;
  vars: Record<string, unknown>;
  assert?: Array<Record<string, unknown>>;
}

function loadTests(): TestCase[] {
  const tests: TestCase[] = [];

  // Track A: Production replay
  const prodPath = resolve(__dirname, 'datasets/production.json');
  if (existsSync(prodPath)) {
    const production = JSON.parse(readFileSync(prodPath, 'utf-8'));
    for (const record of production) {
      tests.push({
        description: `[Production] ${record.path} (draft ${record.draftNumber})`,
        vars: {
          content: record.content,
          assignmentPrompt: record.assignmentPrompt,
          writingType: record.writingType,
          draftNumber: record.draftNumber,
          previousEvaluation: record.previousEvaluation,
          baselineEvaluation: record.evaluation, // For score drift comparison
          dataset: 'production',
        },
        assert: [
          // Score drift tracking (informational, does not fail)
          {
            type: 'javascript',
            value: `
              const evaluation = JSON.parse(output);
              const baseline = context.vars.baselineEvaluation;
              if (!baseline?.traits) return { pass: true, score: 1, reason: 'No baseline' };
              const traits = Object.keys(baseline.traits);
              const drifts = traits.map(t => {
                const bScore = baseline.traits[t]?.score || 0;
                const nScore = evaluation.traits?.[t]?.score || 0;
                return { trait: t, baseline: bScore, new: nScore, delta: nScore - bScore };
              });
              const avgDrift = drifts.reduce((sum, d) => sum + Math.abs(d.delta), 0) / drifts.length;
              return {
                pass: true,
                score: Math.max(0, 1 - avgDrift / 3),
                reason: 'Score drift: ' + drifts.map(d => d.trait + ': ' + (d.delta >= 0 ? '+' : '') + d.delta).join(', ') + ' (avg |delta|: ' + avgDrift.toFixed(1) + ')',
              };
            `,
          },
        ],
      });
    }
  } else {
    console.warn('Warning: production.json not found. Run: npx tsx export-firestore.ts');
  }

  // Track C: Calibration test suite
  const calPath = resolve(__dirname, 'datasets/calibration.json');
  if (existsSync(calPath)) {
    const calibration = JSON.parse(readFileSync(calPath, 'utf-8'));
    for (const essay of calibration) {
      const testCase: TestCase = {
        description: `[Calibration] ${essay.filename}${essay.scoreSource ? ' (' + essay.scoreSource + ')' : ''}`,
        vars: {
          content: essay.content,
          assignmentPrompt: essay.assignmentPrompt,
          writingType: essay.writingType,
          draftNumber: 1,
          previousEvaluation: null,
          expectedAvgScoreRange: essay.expectedAvgScoreRange,
          dataset: 'calibration',
        },
      };

      // Score reasonableness check for essays with expected ranges
      if (essay.expectedAvgScoreRange) {
        testCase.assert = [
          {
            type: 'javascript',
            value: `
              const evaluation = JSON.parse(output);
              const traits = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
              const scores = traits.map(t => evaluation.traits?.[t]?.score || 0);
              const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
              const [min, max] = context.vars.expectedAvgScoreRange;
              const inRange = avg >= min && avg <= max;
              return {
                pass: true,
                score: inRange ? 1 : 0.5,
                reason: 'Avg score ' + avg.toFixed(1) + (inRange ? ' within' : ' OUTSIDE') + ' expected range [' + min + ', ' + max + ']',
              };
            `,
          },
        ];
      }

      tests.push(testCase);
    }
  } else {
    console.warn('Warning: calibration.json not found. Run: npx tsx build-calibration.ts');
  }

  console.log(`Loaded ${tests.length} test cases (production: ${tests.filter(t => (t.vars.dataset as string) === 'production').length}, calibration: ${tests.filter(t => (t.vars.dataset as string) === 'calibration').length})`);
  return tests;
}

export default loadTests();
```

- [ ] **Step 3: Verify config syntax**

Run: `cd eval && npx promptfoo eval --dry-run 2>&1 | head -20`
Expected: Promptfoo parses the config without errors and shows the test case count.

- [ ] **Step 4: Commit**

```bash
git add eval/promptfooconfig.yaml eval/tests.ts
git commit -m "feat: add Promptfoo config with providers, assertions, and test loader"
```

---

### Task 8: Create README

**Files:**
- Create: `eval/README.md`

- [ ] **Step 1: Create eval/README.md**

```markdown
# Essay Grader Model Evaluation

Compares Gemini model outputs for essay grading using Promptfoo.

## Prerequisites

- Node.js 22+
- `GEMINI_API_KEY` — local Gemini API key (not from Firebase secrets)
- `ANTHROPIC_API_KEY` — for Claude judge calls
- Firebase Application Default Credentials (`gcloud auth application-default login`)

## Setup

```bash
cd eval
npm install
```

## Usage

```bash
# 1. Export production data from Firestore
npm run export

# 2. Build calibration dataset from test essays
npm run calibration

# 3. Run evaluation (both models, both tracks)
GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npm run eval

# 4. View interactive comparison UI
npm run view
```

## Date-filtered export

```bash
npx tsx export-firestore.ts --from 2026-01-01 --to 2026-03-31
```

## Adding a new model

1. Add a provider entry in `promptfooconfig.yaml`
2. Run `npm run eval`
3. Compare in the UI with `npm run view`

## Acceptance criteria

| Metric | Threshold |
|--------|-----------|
| Schema pass rate | >= 95% |
| Judge feedback quality delta | <= 0.5 avg |
| Judge annotation Socratic delta | <= 0.5 avg |
| Pairwise preference | Challenger wins/ties >= 40% |
| Latency | Informational |
| Cost | Informational |
| Score drift | Informational |
```

- [ ] **Step 2: Commit**

```bash
git add eval/README.md
git commit -m "docs: add eval framework README with setup and usage"
```

---

### Task 9: Claude Judge Runner Script

**Files:**
- Create: `eval/run-judge.ts`

Promptfoo's `llm-rubric` assertion evaluates the entire output as a string. Our judge needs to iterate over each of the 7 traits in the structured JSON, passing trait-specific feedback and annotations to Claude. This is better handled as a post-processing script that reads Promptfoo's cached outputs and runs the per-trait judge + pairwise comparison.

- [ ] **Step 1: Create run-judge.ts**

```typescript
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Config ──────────────────────────────────────────────────────────────────

const JUDGE_MODEL = 'claude-sonnet-4-6';
const TRAITS = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
const RELIABILITY_SAMPLE_RATE = 0.1; // 10% of essays get judged twice

// ── Types ───────────────────────────────────────────────────────────────────

interface TraitJudgment {
  trait: string;
  specificity: { score: number; rationale: string };
  actionability: { score: number; rationale: string };
  socratic_tone: { score: number; rationale: string };
}

interface PairwiseJudgment {
  winner: 'incumbent' | 'challenger' | 'tie';
  rationale: string;
}

interface JudgeResult {
  description: string;
  incumbentTraitScores: TraitJudgment[];
  challengerTraitScores: TraitJudgment[];
  pairwise: PairwiseJudgment;
  reliabilityCheck?: {
    firstRun: TraitJudgment[];
    secondRun: TraitJudgment[];
    agreementRate: number;
  };
}

// ── Judge prompts ───────────────────────────────────────────────────────────

function buildTraitJudgePrompt(essayContent: string, traitName: string, feedback: string, annotationsJson: string): string {
  return `You are evaluating the quality of essay feedback produced by an AI writing coach.
You will see the student's essay, a specific writing trait being evaluated, and the
AI coach's feedback and annotations for that trait.

Rate the feedback on these three dimensions, each scored 1-5:

## Specificity (applies to the feedback text)
Does the feedback reference concrete details from this specific essay?
- 1: Completely generic, could apply to any essay
- 3: References the essay's topic but not specific passages or details
- 5: Points to exact passages, quotes, or structural elements

## Actionability (applies to the feedback text and revision suggestions)
Can the student act on this feedback without being told what to write?
- 1: Vague encouragement or criticism with no direction
- 3: Identifies what to improve but not how
- 5: Gives a clear, specific next step the student can take

## Socratic Tone (applies ONLY to the annotations array)
Do the annotations guide through questions rather than dictate or rewrite?
- 1: Rewrites the student's text or provides replacement sentences
- 3: Identifies problems but tells rather than asks
- 5: Asks questions that lead the student to discover the issue

Note: The coaching system uses different tones for different score levels. Do NOT penalize appropriate tone variation.

---

ESSAY:
${essayContent}

TRAIT: ${traitName}

FEEDBACK: ${feedback}

ANNOTATIONS:
${annotationsJson}

---

Respond with ONLY a JSON object, no other text:
{"specificity": {"score": N, "rationale": "..."}, "actionability": {"score": N, "rationale": "..."}, "socratic_tone": {"score": N, "rationale": "..."}}`;
}

function buildPairwisePrompt(essayContent: string, incumbentFeedback: string, challengerFeedback: string): string {
  return `You are comparing two sets of essay feedback produced by different AI writing coaches.
Both evaluated the same student essay. Which feedback is more helpful for a student revising this essay?

Consider: specificity, actionability, and whether annotations guide rather than dictate.

ESSAY:
${essayContent}

--- FEEDBACK A ---
${incumbentFeedback}

--- FEEDBACK B ---
${challengerFeedback}

---

Which is more helpful for a student revising this essay? Respond with ONLY a JSON object:
{"winner": "A" or "B" or "tie", "rationale": "one sentence explaining why"}`;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY env var is required');
    process.exit(1);
  }

  // Load Promptfoo output (the latest eval results)
  const outputPath = resolve(__dirname, 'promptfoo-output.json');
  if (!existsSync(outputPath)) {
    console.error('No promptfoo-output.json found. Run: npx promptfoo eval -o promptfoo-output.json');
    process.exit(1);
  }

  const evalResults = JSON.parse(readFileSync(outputPath, 'utf-8'));
  const anthropic = new Anthropic({ apiKey });

  const results: JudgeResult[] = [];
  const reliabilitySample: number[] = [];

  // Determine which essays to double-judge for reliability
  const totalEssays = evalResults.results.length;
  const sampleCount = Math.max(1, Math.ceil(totalEssays * RELIABILITY_SAMPLE_RATE));
  const sampleIndices = new Set<number>();
  while (sampleIndices.size < sampleCount) {
    sampleIndices.add(Math.floor(Math.random() * totalEssays));
  }

  console.log(`Judging ${totalEssays} essay comparisons...`);
  console.log(`Reliability sample: ${sampleCount} essays will be judged twice`);

  for (let i = 0; i < evalResults.results.length; i++) {
    const result = evalResults.results[i];
    const description = result.description || `Essay ${i + 1}`;

    // Extract outputs from both providers
    const incumbentOutput = JSON.parse(result.outputs?.[0]?.text || '{}');
    const challengerOutput = JSON.parse(result.outputs?.[1]?.text || '{}');
    const essayContent = result.vars?.content || '';

    if (!incumbentOutput.traits || !challengerOutput.traits) {
      console.warn(`  Skipping ${description}: missing traits in output`);
      continue;
    }

    console.log(`  [${i + 1}/${totalEssays}] ${description}`);

    // Judge each trait for both models
    const incumbentScores: TraitJudgment[] = [];
    const challengerScores: TraitJudgment[] = [];

    for (const trait of TRAITS) {
      const incTrait = incumbentOutput.traits[trait];
      const chalTrait = challengerOutput.traits[trait];
      if (!incTrait || !chalTrait) continue;

      // Judge incumbent
      const incResponse = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: buildTraitJudgePrompt(
          essayContent, trait, incTrait.feedback, JSON.stringify(incTrait.annotations, null, 2)
        )}],
      });
      const incText = incResponse.content[0].type === 'text' ? incResponse.content[0].text : '';
      const incJudgment = JSON.parse(incText);
      incumbentScores.push({ trait, ...incJudgment });

      // Judge challenger
      const chalResponse = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: buildTraitJudgePrompt(
          essayContent, trait, chalTrait.feedback, JSON.stringify(chalTrait.annotations, null, 2)
        )}],
      });
      const chalText = chalResponse.content[0].type === 'text' ? chalResponse.content[0].text : '';
      const chalJudgment = JSON.parse(chalText);
      challengerScores.push({ trait, ...chalJudgment });
    }

    // Pairwise comparison (whole essay, not per-trait)
    const incSummary = TRAITS.map(t => {
      const trait = incumbentOutput.traits[t];
      return trait ? `${t}: ${trait.feedback}\nAnnotations: ${JSON.stringify(trait.annotations)}` : '';
    }).join('\n\n');
    const chalSummary = TRAITS.map(t => {
      const trait = challengerOutput.traits[t];
      return trait ? `${t}: ${trait.feedback}\nAnnotations: ${JSON.stringify(trait.annotations)}` : '';
    }).join('\n\n');

    const pairResponse = await anthropic.messages.create({
      model: JUDGE_MODEL,
      max_tokens: 200,
      messages: [{ role: 'user', content: buildPairwisePrompt(essayContent, incSummary, chalSummary) }],
    });
    const pairText = pairResponse.content[0].type === 'text' ? pairResponse.content[0].text : '';
    const pairResult = JSON.parse(pairText);
    const pairwise: PairwiseJudgment = {
      winner: pairResult.winner === 'A' ? 'incumbent' : pairResult.winner === 'B' ? 'challenger' : 'tie',
      rationale: pairResult.rationale,
    };

    const judgeResult: JudgeResult = {
      description,
      incumbentTraitScores: incumbentScores,
      challengerTraitScores: challengerScores,
      pairwise,
    };

    // Reliability check: re-judge one trait for the sample
    if (sampleIndices.has(i) && incumbentScores.length > 0) {
      const checkTrait = incumbentScores[0].trait;
      const incTrait = incumbentOutput.traits[checkTrait];
      const rerunResponse = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 300,
        messages: [{ role: 'user', content: buildTraitJudgePrompt(
          essayContent, checkTrait, incTrait.feedback, JSON.stringify(incTrait.annotations, null, 2)
        )}],
      });
      const rerunText = rerunResponse.content[0].type === 'text' ? rerunResponse.content[0].text : '';
      const rerunJudgment = JSON.parse(rerunText);

      // Compare first run vs rerun
      const firstRun = incumbentScores[0];
      const agree = (
        firstRun.specificity.score === rerunJudgment.specificity.score &&
        firstRun.actionability.score === rerunJudgment.actionability.score &&
        firstRun.socratic_tone.score === rerunJudgment.socratic_tone.score
      );
      reliabilitySample.push(agree ? 1 : 0);

      judgeResult.reliabilityCheck = {
        firstRun: [firstRun],
        secondRun: [{ trait: checkTrait, ...rerunJudgment }],
        agreementRate: agree ? 1 : 0,
      };
    }

    results.push(judgeResult);
  }

  // ── Summary ─────────────────────────────────────────────────────────────

  // Aggregate scores
  const incAvg = { specificity: 0, actionability: 0, socratic_tone: 0, count: 0 };
  const chalAvg = { specificity: 0, actionability: 0, socratic_tone: 0, count: 0 };

  for (const r of results) {
    for (const t of r.incumbentTraitScores) {
      incAvg.specificity += t.specificity.score;
      incAvg.actionability += t.actionability.score;
      incAvg.socratic_tone += t.socratic_tone.score;
      incAvg.count++;
    }
    for (const t of r.challengerTraitScores) {
      chalAvg.specificity += t.specificity.score;
      chalAvg.actionability += t.actionability.score;
      chalAvg.socratic_tone += t.socratic_tone.score;
      chalAvg.count++;
    }
  }

  const div = (n: number, d: number) => d > 0 ? (n / d).toFixed(2) : 'N/A';

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('              JUDGE RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Average scores (1-5):');
  console.log(`  Incumbent  — Specificity: ${div(incAvg.specificity, incAvg.count)}, Actionability: ${div(incAvg.actionability, incAvg.count)}, Socratic: ${div(incAvg.socratic_tone, incAvg.count)}`);
  console.log(`  Challenger — Specificity: ${div(chalAvg.specificity, chalAvg.count)}, Actionability: ${div(chalAvg.actionability, chalAvg.count)}, Socratic: ${div(chalAvg.socratic_tone, chalAvg.count)}`);

  const deltas = {
    specificity: Math.abs(parseFloat(div(incAvg.specificity, incAvg.count)) - parseFloat(div(chalAvg.specificity, chalAvg.count))),
    actionability: Math.abs(parseFloat(div(incAvg.actionability, incAvg.count)) - parseFloat(div(chalAvg.actionability, chalAvg.count))),
    socratic: Math.abs(parseFloat(div(incAvg.socratic_tone, incAvg.count)) - parseFloat(div(chalAvg.socratic_tone, chalAvg.count))),
  };
  console.log(`\n  Deltas — Specificity: ${deltas.specificity.toFixed(2)}, Actionability: ${deltas.actionability.toFixed(2)}, Socratic: ${deltas.socratic.toFixed(2)}`);
  const feedbackDelta = (deltas.specificity + deltas.actionability) / 2;
  console.log(`  Feedback quality delta (spec+act avg): ${feedbackDelta.toFixed(2)} ${feedbackDelta <= 0.5 ? 'PASS' : 'FAIL'} (threshold: <= 0.5)`);
  console.log(`  Socratic delta: ${deltas.socratic.toFixed(2)} ${deltas.socratic <= 0.5 ? 'PASS' : 'FAIL'} (threshold: <= 0.5)`);

  // Pairwise
  const pairwiseCounts = { incumbent: 0, challenger: 0, tie: 0 };
  for (const r of results) {
    pairwiseCounts[r.pairwise.winner]++;
  }
  const challengerWinRate = (pairwiseCounts.challenger + pairwiseCounts.tie) / results.length;
  console.log(`\nPairwise: Incumbent ${pairwiseCounts.incumbent}, Challenger ${pairwiseCounts.challenger}, Tie ${pairwiseCounts.tie}`);
  console.log(`  Challenger wins/ties: ${(challengerWinRate * 100).toFixed(0)}% ${challengerWinRate >= 0.4 ? 'PASS' : 'FAIL'} (threshold: >= 40%)`);

  // Reliability
  if (reliabilitySample.length > 0) {
    const agreement = reliabilitySample.reduce((a, b) => a + b, 0) / reliabilitySample.length;
    console.log(`\nJudge reliability: ${(agreement * 100).toFixed(0)}% agreement on ${reliabilitySample.length} re-runs ${agreement >= 0.8 ? 'OK' : 'WARNING: below 80%'}`);
  }

  // Save full results
  const reportPath = resolve(__dirname, 'judge-results.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to ${reportPath}`);
}

main().catch((err) => {
  console.error('Judge failed:', err.message || err);
  process.exit(1);
});
```

- [ ] **Step 2: Add @anthropic-ai/sdk to package.json**

In `eval/package.json`, add to dependencies:

```json
"@anthropic-ai/sdk": "^0.30.0"
```

Run: `cd eval && npm install`

- [ ] **Step 3: Add judge run script to package.json**

In `eval/package.json`, add to scripts:

```json
"judge": "tsx run-judge.ts"
```

- [ ] **Step 4: Update README with judge step**

In `eval/README.md`, update the Usage section to include:

```markdown
# 3. Run evaluation (both models, both tracks)
GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npm run eval -- -o promptfoo-output.json

# 4. Run Claude judge on results
ANTHROPIC_API_KEY=xxx npm run judge

# 5. View interactive comparison UI
npm run view
```

- [ ] **Step 5: Commit**

```bash
git add eval/run-judge.ts eval/package.json eval/README.md
git commit -m "feat: add Claude judge runner with per-trait scoring, pairwise, and reliability checks"
```

---

### Task 10: End-to-End Smoke Test

**Files:** None new — this validates everything works together.

- [ ] **Step 1: Generate both datasets**

Run:
```bash
cd eval
npx tsx export-firestore.ts
npx tsx build-calibration.ts
```

Expected: Both `datasets/production.json` and `datasets/calibration.json` exist with data.

- [ ] **Step 2: Run Promptfoo eval with a small subset**

Run a quick test with just 2 calibration essays to verify the full pipeline works:

```bash
cd eval
GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npx promptfoo eval --filter-description "Calibration.*act-machines-score1|Calibration.*act-machines-score6" -o promptfoo-output.json --no-cache
```

Expected: Promptfoo runs both models against the two essays, shows results with assertion pass/fail. `promptfoo-output.json` is created.

- [ ] **Step 3: Run the Claude judge on the smoke test results**

Run:
```bash
cd eval
ANTHROPIC_API_KEY=xxx npx tsx run-judge.ts
```

Expected: Judge processes 2 essays, outputs per-trait scores for both models, pairwise winner, and saves `judge-results.json`.

- [ ] **Step 4: Open the comparison UI**

Run: `cd eval && npx promptfoo view`

Expected: Browser opens with side-by-side comparison of the two models' outputs. Verify you can see:
- Both providers listed
- Assertion results (is-json, schema validation, score drift)
- Output for each test case

- [ ] **Step 5: Verify structural compliance assertions work**

Check the Promptfoo output for the schema validation assertion. Both models should pass (valid JSON with all traits, scores 1-6). If either fails, note the failure reason.

- [ ] **Step 6: Run the full evaluation (optional — costs ~$10)**

Once the smoke test passes, run the full suite:

```bash
cd eval
GEMINI_API_KEY=xxx ANTHROPIC_API_KEY=xxx npx promptfoo eval -o promptfoo-output.json --no-cache
ANTHROPIC_API_KEY=xxx npx tsx run-judge.ts
```

This runs all 110 essays x 2 models = 220 Gemini calls, then ~1,540 Claude judge calls plus pairwise and reliability checks.

- [ ] **Step 7: Final commit**

If any fixes were needed during smoke testing, commit them:

```bash
git add -A eval/
git commit -m "fix: smoke test fixes for eval framework"
```
