/**
 * Configuration search: find the cheapest configuration that passes
 * the full-output validator against production baselines.
 *
 * Tests different configurations:
 * - Which model for each analysis
 * - Which analyses can be combined in one call
 * - v3 quality boost on/off per analysis
 *
 * Each config is tested on 3 production essays. Configs that pass the
 * full validator get a cost estimate. Winner = cheapest passing config.
 *
 * Usage: GEMINI_API_KEY=xxx npx tsx config-search.ts
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';
import { GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/grammar.js';
import { TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA } from '../../functions/lib/functions/src/transitions.js';
import { PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/promptAdherence.js';
import { DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/duplication.js';
import { COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA } from '../../functions/lib/functions/src/synthesizeCoach.js';
import { validateFullOutput } from '../validate-full-output.js';

const __dirname = dirname(new URL(import.meta.url).pathname);

const PRO = 'gemini-3.1-pro-preview';
const FLASH = 'gemini-3.1-flash-lite-preview';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const V3_BOOST = `\n\n## CRITICAL: FEEDBACK QUALITY STANDARDS
Every feedback statement must reference EXACT text from the essay. No generic praise or criticism.
Name the specific craft move or error type. Check for factual errors and anachronisms.
Each annotation must end with a Socratic question referencing the student's actual words.
Before finalizing: verify every feedback cites specific text and every annotation has a Socratic question.`;

// ── Analysis runners ────────────────────────────────────────────────────

interface AnalysisResult {
  evaluation?: any;
  grammarAnalysis?: any;
  transitionAnalysis?: any;
  promptAnalysis?: any;
  duplicationAnalysis?: any;
  coachSynthesis?: any;
}

async function runSingleAnalysis(
  ai: any, model: string, content: string, assignmentPrompt: string, writingType: string,
  systemPrompt: string, schema: any, userPrompt: string,
): Promise<any> {
  const resp = await ai.models.generateContent({
    model,
    contents: userPrompt,
    config: { systemInstruction: systemPrompt, responseMimeType: 'application/json', responseSchema: schema },
  });
  return JSON.parse(resp.text || '{}');
}

// ── Configurations to test ──────────────────────────────────────────────

interface Config {
  name: string;
  description: string;
  estimatedCalls: number;
  /** Run this config on a test essay, return all 6 analyses */
  run: (ai: any, content: string, assignmentPrompt: string, writingType: string) => Promise<AnalysisResult>;
}

function buildUserPrompt(content: string, assignmentPrompt: string, writingType: string): string {
  return buildEvaluationPrompt({ assignmentPrompt, writingType, content });
}

const CONFIGS: Config[] = [
  {
    name: 'baseline-6-pro',
    description: '6 separate Pro calls (current production)',
    estimatedCalls: 6,
    run: async (ai, content, assignmentPrompt, writingType) => {
      const evalPrompt = buildUserPrompt(content, assignmentPrompt, writingType);
      const grammarPrompt = `Analyze the grammar of this student essay:\n\n${content}`;
      const transPrompt = `Analyze transitions in this student essay:\n\n${content}`;
      const promptPrompt = `Analyze how well this essay addresses the assignment prompt.\n\n## Assignment Prompt\n${assignmentPrompt}\n\n## Student Essay\n${content}`;
      const dupPrompt = `Analyze this student essay for repeated ideas.\n\n${content}`;

      const [evalResult, gramResult, transResult, promptResult, dupResult] = await Promise.all([
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, SYSTEM_PROMPT, EVALUATION_SCHEMA, evalPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA, grammarPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA, transPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA, promptPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA, dupPrompt),
      ]);

      // Coach synthesis would normally poll and aggregate — for now just build input
      const coachPrompt = `Draft number: 1\nHas assignment prompt: ${!!assignmentPrompt}\n\n## Trait Evaluation\n${JSON.stringify(evalResult)}\n\n## Grammar Analysis\n${JSON.stringify(gramResult)}\n\n## Transition Analysis\n${JSON.stringify(transResult)}\n\n## Prompt Adherence\n${JSON.stringify(promptResult)}\n\n## Duplication Analysis\n${JSON.stringify(dupResult)}\n\nProduce a coaching synthesis JSON. This is draft 1 — readiness must be "keep_going". improvements must be null.`;
      const coachResult = await runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA, coachPrompt);

      return { evaluation: evalResult, grammarAnalysis: gramResult, transitionAnalysis: transResult, promptAnalysis: promptResult, duplicationAnalysis: dupResult, coachSynthesis: coachResult };
    },
  },
  {
    name: 'flash-eval-pro-rest',
    description: 'Flash Lite + v3 for evaluation only, Pro for grammar/transitions/prompt/dup, Pro for coach',
    estimatedCalls: 6,
    run: async (ai, content, assignmentPrompt, writingType) => {
      const evalPrompt = buildUserPrompt(content, assignmentPrompt, writingType);
      const grammarPrompt = `Analyze the grammar of this student essay:\n\n${content}`;
      const transPrompt = `Analyze transitions in this student essay:\n\n${content}`;
      const promptPrompt = `Analyze how well this essay addresses the assignment prompt.\n\n## Assignment Prompt\n${assignmentPrompt}\n\n## Student Essay\n${content}`;
      const dupPrompt = `Analyze this student essay for repeated ideas.\n\n${content}`;

      const [evalResult, gramResult, transResult, promptResult, dupResult] = await Promise.all([
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, SYSTEM_PROMPT + V3_BOOST, EVALUATION_SCHEMA, evalPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA, grammarPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA, transPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA, promptPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA, dupPrompt),
      ]);

      const coachPrompt = `Draft number: 1\nHas assignment prompt: ${!!assignmentPrompt}\n\n## Trait Evaluation\n${JSON.stringify(evalResult)}\n\n## Grammar Analysis\n${JSON.stringify(gramResult)}\n\n## Transition Analysis\n${JSON.stringify(transResult)}\n\n## Prompt Adherence\n${JSON.stringify(promptResult)}\n\n## Duplication Analysis\n${JSON.stringify(dupResult)}\n\nProduce a coaching synthesis JSON. This is draft 1 — readiness must be "keep_going". improvements must be null.`;
      const coachResult = await runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA, coachPrompt);

      return { evaluation: evalResult, grammarAnalysis: gramResult, transitionAnalysis: transResult, promptAnalysis: promptResult, duplicationAnalysis: dupResult, coachSynthesis: coachResult };
    },
  },
  {
    name: 'flash-eval+dup-pro-rest',
    description: 'Flash Lite for eval+duplication (lightweight), Pro for grammar/transitions/prompt, Pro for coach',
    estimatedCalls: 6,
    run: async (ai, content, assignmentPrompt, writingType) => {
      const evalPrompt = buildUserPrompt(content, assignmentPrompt, writingType);
      const grammarPrompt = `Analyze the grammar of this student essay:\n\n${content}`;
      const transPrompt = `Analyze transitions in this student essay:\n\n${content}`;
      const promptPrompt = `Analyze how well this essay addresses the assignment prompt.\n\n## Assignment Prompt\n${assignmentPrompt}\n\n## Student Essay\n${content}`;
      const dupPrompt = `Analyze this student essay for repeated ideas.\n\n${content}`;

      const [evalResult, gramResult, transResult, promptResult, dupResult] = await Promise.all([
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, SYSTEM_PROMPT + V3_BOOST, EVALUATION_SCHEMA, evalPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA, grammarPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA, transPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA, promptPrompt),
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA, dupPrompt),
      ]);

      const coachPrompt = `Draft number: 1\nHas assignment prompt: ${!!assignmentPrompt}\n\n## Trait Evaluation\n${JSON.stringify(evalResult)}\n\n## Grammar Analysis\n${JSON.stringify(gramResult)}\n\n## Transition Analysis\n${JSON.stringify(transResult)}\n\n## Prompt Adherence\n${JSON.stringify(promptResult)}\n\n## Duplication Analysis\n${JSON.stringify(dupResult)}\n\nProduce a coaching synthesis JSON. This is draft 1 — readiness must be "keep_going". improvements must be null.`;
      const coachResult = await runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA, coachPrompt);

      return { evaluation: evalResult, grammarAnalysis: gramResult, transitionAnalysis: transResult, promptAnalysis: promptResult, duplicationAnalysis: dupResult, coachSynthesis: coachResult };
    },
  },
  {
    name: 'all-flash-separate',
    description: 'All 6 analyses with Flash Lite + v3 boost, separate calls',
    estimatedCalls: 6,
    run: async (ai, content, assignmentPrompt, writingType) => {
      const evalPrompt = buildUserPrompt(content, assignmentPrompt, writingType);
      const grammarPrompt = `Analyze the grammar of this student essay:\n\n${content}`;
      const transPrompt = `Analyze transitions in this student essay:\n\n${content}`;
      const promptPrompt = `Analyze how well this essay addresses the assignment prompt.\n\n## Assignment Prompt\n${assignmentPrompt}\n\n## Student Essay\n${content}`;
      const dupPrompt = `Analyze this student essay for repeated ideas.\n\n${content}`;

      const [evalResult, gramResult, transResult, promptResult, dupResult] = await Promise.all([
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, SYSTEM_PROMPT + V3_BOOST, EVALUATION_SCHEMA, evalPrompt),
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, GRAMMAR_SYSTEM_PROMPT + V3_BOOST, GRAMMAR_ANALYSIS_SCHEMA, grammarPrompt),
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, TRANSITION_SYSTEM_PROMPT + V3_BOOST, TRANSITION_SCHEMA, transPrompt),
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, PROMPT_ADHERENCE_SYSTEM_PROMPT + V3_BOOST, PROMPT_ANALYSIS_SCHEMA, promptPrompt),
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, DUPLICATION_SYSTEM_PROMPT + V3_BOOST, DUPLICATION_ANALYSIS_SCHEMA, dupPrompt),
      ]);

      const coachPrompt = `Draft number: 1\nHas assignment prompt: ${!!assignmentPrompt}\n\n## Trait Evaluation\n${JSON.stringify(evalResult)}\n\n## Grammar Analysis\n${JSON.stringify(gramResult)}\n\n## Transition Analysis\n${JSON.stringify(transResult)}\n\n## Prompt Adherence\n${JSON.stringify(promptResult)}\n\n## Duplication Analysis\n${JSON.stringify(dupResult)}\n\nProduce a coaching synthesis JSON. This is draft 1 — readiness must be "keep_going". improvements must be null.`;
      const coachResult = await runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA, coachPrompt);

      return { evaluation: evalResult, grammarAnalysis: gramResult, transitionAnalysis: transResult, promptAnalysis: promptResult, duplicationAnalysis: dupResult, coachSynthesis: coachResult };
    },
  },
  {
    name: '2-call-split',
    description: 'Call 1: eval+dup+coach (Flash), Call 2: grammar+transitions+prompt (Pro)',
    estimatedCalls: 2,
    run: async (ai, content, assignmentPrompt, writingType) => {
      // Call 1: judgment tasks (Flash Lite + v3)
      const evalDupCoachSystem = `${SYSTEM_PROMPT}\n\n## DUPLICATION ANALYSIS\n${DUPLICATION_SYSTEM_PROMPT}\n\n## COACH SYNTHESIS\n${COACH_SYNTHESIS_SYSTEM}${V3_BOOST}`;
      const evalDupCoachSchema = {
        type: 'object' as const,
        properties: {
          evaluation: EVALUATION_SCHEMA,
          duplicationAnalysis: DUPLICATION_ANALYSIS_SCHEMA,
          coachSynthesis: COACH_SYNTHESIS_SCHEMA,
        },
        required: ['evaluation', 'duplicationAnalysis', 'coachSynthesis'] as const,
      };
      const evalDupCoachPrompt = buildUserPrompt(content, assignmentPrompt, writingType) +
        '\n\nAlso analyze for duplicated ideas and provide a coach synthesis. Draft 1 — readiness must be "keep_going", improvements null.';

      // Call 2: exhaustive tasks (Pro)
      const gramTransPromptSystem = `${GRAMMAR_SYSTEM_PROMPT}\n\n## TRANSITION ANALYSIS\n${TRANSITION_SYSTEM_PROMPT}\n\n## PROMPT ADHERENCE\n${PROMPT_ADHERENCE_SYSTEM_PROMPT}`;
      const gramTransPromptSchema = {
        type: 'object' as const,
        properties: {
          grammarAnalysis: GRAMMAR_ANALYSIS_SCHEMA,
          transitionAnalysis: TRANSITION_SCHEMA,
          promptAnalysis: PROMPT_ANALYSIS_SCHEMA,
        },
        required: ['grammarAnalysis', 'transitionAnalysis', 'promptAnalysis'] as const,
      };
      const gramTransPromptPrompt = `Analyze this student essay for grammar errors, transition quality, and prompt adherence.\n\n## Assignment Prompt\n${assignmentPrompt}\n\n## Student Essay\n${content}`;

      const [combo1, combo2] = await Promise.all([
        runSingleAnalysis(ai, FLASH, content, assignmentPrompt, writingType, evalDupCoachSystem, evalDupCoachSchema, evalDupCoachPrompt),
        runSingleAnalysis(ai, PRO, content, assignmentPrompt, writingType, gramTransPromptSystem, gramTransPromptSchema, gramTransPromptPrompt),
      ]);

      return {
        evaluation: combo1.evaluation,
        duplicationAnalysis: combo1.duplicationAnalysis,
        coachSynthesis: combo1.coachSynthesis,
        grammarAnalysis: combo2.grammarAnalysis,
        transitionAnalysis: combo2.transitionAnalysis,
        promptAnalysis: combo2.promptAnalysis,
      };
    },
  },
];

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  // Pick 3 diverse production essays with full analysis data
  const prod = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));
  const complete = prod.filter((r: any) =>
    r.draftNumber === 1 && r.transitionAnalysis && r.grammarAnalysis
  );
  const sample = [complete[0], complete[Math.floor(complete.length / 2)], complete[complete.length - 1]];

  console.log(`Testing ${CONFIGS.length} configurations on ${sample.length} production essays\n`);

  const results: Array<{ name: string; description: string; calls: number; passRate: number; failures: string[] }> = [];

  for (const config of CONFIGS) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`CONFIG: ${config.name}`);
    console.log(`${config.description}`);
    console.log(`${'═'.repeat(50)}\n`);

    let passed = 0;
    const allFailures: string[] = [];

    for (let i = 0; i < sample.length; i++) {
      const record = sample[i];
      const wc = record.content.split(/\s+/).length;
      const shortName = record.path.split('/').pop();

      try {
        const result = await config.run(ai, record.content, record.assignmentPrompt, record.writingType);
        const checks = validateFullOutput(result, wc);
        const critFails = checks.filter(c => !c.pass && c.severity === 'critical');

        if (critFails.length === 0) {
          console.log(`  [${i + 1}] ${shortName} (${wc}w): PASS`);
          passed++;
        } else {
          console.log(`  [${i + 1}] ${shortName} (${wc}w): FAIL`);
          for (const f of critFails) {
            console.log(`    ✗ ${f.name}: expected ${f.expected}, got ${f.actual}`);
            allFailures.push(`${shortName}: ${f.name}`);
          }
        }
      } catch (err) {
        console.log(`  [${i + 1}] ${shortName}: ERROR — ${err instanceof Error ? err.message : err}`);
        allFailures.push(`${shortName}: error`);
      }

      await sleep(3000);
    }

    results.push({
      name: config.name,
      description: config.description,
      calls: config.estimatedCalls,
      passRate: passed / sample.length,
      failures: allFailures,
    });

    console.log(`\n  Result: ${passed}/${sample.length} passed`);
  }

  // Summary
  console.log(`\n${'═'.repeat(60)}`);
  console.log('CONFIGURATION SEARCH RESULTS');
  console.log(`${'═'.repeat(60)}\n`);
  console.log('Config'.padEnd(25), 'Calls'.padEnd(7), 'Pass%'.padEnd(8), 'Failures');
  for (const r of results) {
    const passPct = (r.passRate * 100).toFixed(0) + '%';
    console.log(r.name.padEnd(25), String(r.calls).padEnd(7), passPct.padEnd(8), r.failures.length === 0 ? 'none' : r.failures.join(', '));
  }

  console.log('\nPassing configs (cheapest first):');
  const passing = results.filter(r => r.passRate === 1.0).sort((a, b) => a.calls - b.calls);
  if (passing.length === 0) {
    console.log('  No config passed all essays. Investigate failures above.');
  } else {
    for (const r of passing) {
      console.log(`  ✓ ${r.name} (${r.calls} calls): ${r.description}`);
    }
  }
}

main().catch(err => { console.error(err); process.exit(1); });
