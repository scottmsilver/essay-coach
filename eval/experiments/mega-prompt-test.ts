/**
 * Experiment: Can we combine all 5 analyses into a single Gemini call?
 *
 * Runs one essay through:
 * 1. The current separate-call approach (5 calls)
 * 2. A single mega-prompt approach (1 call)
 *
 * Compares output quality side by side.
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';

const __dirname = dirname(new URL(import.meta.url).pathname);

const MODEL = process.env.GEMINI_MODEL || 'gemini-3.1-pro-preview';

// ── Combined system prompt ──────────────────────────────────────────────────

const MEGA_SYSTEM_PROMPT = `You are an expert writing coach and analyst for high school students. You will perform a COMPLETE analysis of a student essay in a single pass, covering all of the following:

1. **6+1 TRAIT EVALUATION** — Score each trait 1-6 with specific feedback and Socratic annotations
2. **GRAMMAR ANALYSIS** — Identify mechanical errors and patterns
3. **TRANSITION ANALYSIS** — Rate sentence and paragraph transitions
4. **COACH SYNTHESIS** — Summarize readiness and recommend next focus area

${SYSTEM_PROMPT}

## ADDITIONAL: GRAMMAR ANALYSIS

After the trait evaluation, analyze grammar covering:
- Sentence-level errors: comma splices, run-ons, fragments, subject-verb agreement, pronoun reference, verb tense consistency, parallel structure, punctuation errors, missing commas
- Higher-order patterns: sentence variety, active/passive voice
- For each error, quote the exact text and use Socratic guidance
- Severity: "error" (definitively wrong), "warning" (likely wrong), "pattern" (stylistic observation)

## ADDITIONAL: TRANSITION ANALYSIS

Analyze how ideas connect:
- Rate sentence-to-sentence transitions within paragraphs
- Rate paragraph-to-paragraph transitions
- Quality levels: "smooth", "adequate", "weak", "missing"
- Provide a brief summary of overall flow

## ADDITIONAL: COACH SYNTHESIS

Based on ALL the above analyses, provide:
- Readiness level: "keep_going" (multiple significant issues), "getting_close" (1-2 areas need attention), "almost_there" (1 minor issue), "ready" (all clear)
- A 1-2 sentence warm, direct coach note
- Which report area to focus on next: "grammar", "transitions", "overall"
- Never say "ready" for a first draft`;

// ── Combined response schema ────────────────────────────────────────────────

const MEGA_SCHEMA = {
  type: 'object' as const,
  properties: {
    // 1. Full trait evaluation (same as current)
    evaluation: EVALUATION_SCHEMA,

    // 2. Grammar (simplified — just the key findings)
    grammarAnalysis: {
      type: 'object' as const,
      properties: {
        errors: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              category: { type: 'string' as const },
              quotedText: { type: 'string' as const },
              comment: { type: 'string' as const },
              severity: { type: 'string' as const },
            },
            required: ['category', 'quotedText', 'comment', 'severity'],
          },
        },
        summary: {
          type: 'object' as const,
          properties: {
            totalErrors: { type: 'number' as const },
            overallComment: { type: 'string' as const },
            strengthAreas: { type: 'array' as const, items: { type: 'string' as const } },
            priorityFixes: { type: 'array' as const, items: { type: 'string' as const } },
          },
          required: ['totalErrors', 'overallComment', 'strengthAreas', 'priorityFixes'],
        },
      },
      required: ['errors', 'summary'],
    },

    // 3. Transitions (simplified)
    transitionAnalysis: {
      type: 'object' as const,
      properties: {
        paragraphTransitions: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              fromParagraph: { type: 'number' as const },
              toParagraph: { type: 'number' as const },
              quality: { type: 'string' as const },
              comment: { type: 'string' as const },
            },
            required: ['fromParagraph', 'toParagraph', 'quality', 'comment'],
          },
        },
        summary: { type: 'string' as const },
      },
      required: ['paragraphTransitions', 'summary'],
    },

    // 4. Coach synthesis
    coachSynthesis: {
      type: 'object' as const,
      properties: {
        readiness: { type: 'string' as const },
        coachNote: { type: 'string' as const },
        recommendedReport: { type: 'string' as const },
      },
      required: ['readiness', 'coachNote', 'recommendedReport'],
    },
  },
  required: ['evaluation', 'grammarAnalysis', 'transitionAnalysis', 'coachSynthesis'],
};

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY required');
    process.exit(1);
  }

  // Load a test essay
  const calPath = resolve(__dirname, '../datasets/calibration.json');
  const calibration = JSON.parse(readFileSync(calPath, 'utf-8'));

  // Pick a mid-quality essay for the test (ACT score 3 — developing)
  const testEssay = calibration.find((e: any) => e.filename === 'act-machines-score3.txt');
  if (!testEssay) {
    console.error('Test essay not found');
    process.exit(1);
  }

  console.log(`Testing with: ${testEssay.filename}`);
  console.log(`Model: ${MODEL}`);
  console.log(`Essay length: ${testEssay.content.split(/\s+/).length} words\n`);

  const ai = new GoogleGenAI({ apiKey });

  // ── Run 1: Current separate evaluation call ────────────────────────────
  console.log('═══ RUN 1: Separate evaluation call (current approach) ═══\n');
  const evalStart = Date.now();

  const evalPrompt = buildEvaluationPrompt({
    assignmentPrompt: testEssay.assignmentPrompt,
    writingType: testEssay.writingType,
    content: testEssay.content,
  });

  const evalResponse = await ai.models.generateContent({
    model: MODEL,
    contents: evalPrompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: EVALUATION_SCHEMA,
    },
  });

  const evalTime = Date.now() - evalStart;
  const evalResult = JSON.parse(evalResponse.text || '{}');

  console.log(`Time: ${(evalTime / 1000).toFixed(1)}s`);
  console.log(`Traits: ${Object.entries(evalResult.traits || {}).map(([k, v]: [string, any]) => `${k}=${v.score}`).join(', ')}`);
  console.log(`Overall: ${evalResult.overallFeedback?.substring(0, 100)}...`);

  // ── Run 2: Mega-prompt (all analyses in one call) ─────────────────────
  console.log('\n═══ RUN 2: Mega-prompt (all analyses in one call) ═══\n');
  const megaStart = Date.now();

  const megaPrompt = `Perform a complete analysis of the following ${testEssay.writingType} essay.

## Assignment Prompt
${testEssay.assignmentPrompt}

## Student Essay
${testEssay.content}

Analyze this essay comprehensively: score all 6+1 traits, identify grammar issues, analyze transitions, and provide a coach synthesis. Return a single JSON object with all analyses.

Remember: Score each trait independently. Do not inflate or deflate scores. Use Socratic questions in annotations.`;

  const megaResponse = await ai.models.generateContent({
    model: MODEL,
    contents: megaPrompt,
    config: {
      systemInstruction: MEGA_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: MEGA_SCHEMA,
    },
  });

  const megaTime = Date.now() - megaStart;
  const megaResult = JSON.parse(megaResponse.text || '{}');

  console.log(`Time: ${(megaTime / 1000).toFixed(1)}s`);

  const megaEval = megaResult.evaluation || {};
  console.log(`Traits: ${Object.entries(megaEval.traits || {}).map(([k, v]: [string, any]) => `${k}=${v.score}`).join(', ')}`);
  console.log(`Overall: ${megaEval.overallFeedback?.substring(0, 100)}...`);

  console.log(`\nGrammar errors found: ${megaResult.grammarAnalysis?.errors?.length || 0}`);
  console.log(`Grammar summary: ${megaResult.grammarAnalysis?.summary?.overallComment?.substring(0, 100)}...`);
  console.log(`Transitions: ${megaResult.transitionAnalysis?.paragraphTransitions?.length || 0} paragraph transitions analyzed`);
  console.log(`Transition summary: ${megaResult.transitionAnalysis?.summary?.substring(0, 100)}...`);
  console.log(`Coach: ${megaResult.coachSynthesis?.readiness} — ${megaResult.coachSynthesis?.coachNote}`);

  // ── Comparison ────────────────────────────────────────────────────────
  console.log('\n═══ COMPARISON ═══\n');
  console.log(`Time: separate=${(evalTime/1000).toFixed(1)}s, mega=${(megaTime/1000).toFixed(1)}s (${(evalTime/megaTime).toFixed(1)}x)`);
  console.log('(Note: separate is 1 of 5 calls. Full separate approach would be ~5x that time.)\n');

  console.log('Score comparison (separate → mega):');
  const traits = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
  let totalDrift = 0;
  for (const t of traits) {
    const sep = evalResult.traits?.[t]?.score || '?';
    const mega = megaEval.traits?.[t]?.score || '?';
    const drift = typeof sep === 'number' && typeof mega === 'number' ? mega - sep : '?';
    if (typeof drift === 'number') totalDrift += Math.abs(drift);
    console.log(`  ${t.padEnd(18)} ${sep} → ${mega} (${typeof drift === 'number' ? (drift >= 0 ? '+' : '') + drift : drift})`);
  }
  console.log(`  Average |drift|: ${(totalDrift / traits.length).toFixed(1)}`);

  console.log('\nMega-prompt bonus outputs:');
  console.log(`  Grammar: ${megaResult.grammarAnalysis?.summary?.totalErrors || 0} errors, ${megaResult.grammarAnalysis?.errors?.length || 0} instances`);
  console.log(`  Transitions: ${megaResult.transitionAnalysis?.paragraphTransitions?.map((t: any) => t.quality).join(', ') || 'none'}`);
  console.log(`  Coach: readiness=${megaResult.coachSynthesis?.readiness}, focus=${megaResult.coachSynthesis?.recommendedReport}`);
}

main().catch((err) => {
  console.error('Failed:', err.message || err);
  process.exit(1);
});
