/**
 * Config-driven evaluator for the autotune loop.
 *
 * Reads config.json, runs the configured analyses on 3 production essays,
 * validates with validate-full-output.ts, reports pass/fail + cost estimate.
 *
 * Usage: GEMINI_API_KEY=xxx npx tsx run-config-eval.ts
 *
 * Output (last 3 lines, machine-readable):
 *   PASS_RATE: N/3
 *   COST_ESTIMATE: ~$X.XX per essay
 *   FAILURES: none | list of failures
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { validateFullOutput } from '../validate-full-output.js';

// Import system prompts and schemas
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';
import { GRAMMAR_SYSTEM_PROMPT, GRAMMAR_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/grammar.js';
import { TRANSITION_SYSTEM_PROMPT, TRANSITION_SCHEMA, formatSentencesForPrompt, buildTransitionPrompt, splitEssayIntoSentences } from '../../functions/lib/functions/src/transitions.js';
import { splitSentences, splitParagraphs } from '../../functions/lib/functions/src/sentenceSplitter.js';
import { PROMPT_ADHERENCE_SYSTEM_PROMPT, PROMPT_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/promptAdherence.js';
import { DUPLICATION_SYSTEM_PROMPT, DUPLICATION_ANALYSIS_SCHEMA } from '../../functions/lib/functions/src/duplication.js';
import { COACH_SYNTHESIS_SYSTEM, COACH_SYNTHESIS_SCHEMA } from '../../functions/lib/functions/src/synthesizeCoach.js';

const __dirname = dirname(new URL(import.meta.url).pathname);
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// ── Ollama support ──────────────────────────────────────────────────────
// Models prefixed with "ollama:" are routed to a local Ollama instance.
// e.g. "ollama:gemma3:4b" → calls localhost:11434/api/generate with model "gemma3:4b"
// Note: Ollama doesn't support responseSchema — we include schema in the prompt.

function isOllamaModel(model: string): boolean {
  return model.startsWith('ollama:');
}

function ollamaModelName(model: string): string {
  return model.replace('ollama:', '');
}

async function callOllama(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: any,
): Promise<any> {
  const ollamaModel = ollamaModelName(model);

  // Embed schema instructions in the prompt since Ollama doesn't support responseSchema
  const schemaInstruction = `\n\nYou MUST respond with valid JSON that matches this exact schema:\n${JSON.stringify(schema, null, 2)}\n\nRespond ONLY with the JSON object, no other text.`;

  const resp = await fetch('http://localhost:11434/api/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: ollamaModel,
      system: systemPrompt + schemaInstruction,
      prompt: userPrompt,
      format: 'json',
      stream: false,
      options: { temperature: 0.2, num_ctx: 8192 },
    }),
  });

  if (!resp.ok) {
    throw new Error(`Ollama error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as { response: string };
  return JSON.parse(data.response);
}

// ── Anthropic support ───────────────────────────────────────────────────
// Models prefixed with "anthropic:" are routed to the Anthropic Messages API.
// e.g. "anthropic:claude-haiku-4-5-20251001"
// Uses ANTHROPIC_API_KEY from environment.

function isAnthropicModel(model: string): boolean {
  return model.startsWith('anthropic:');
}

function anthropicModelName(model: string): string {
  return model.replace('anthropic:', '');
}

async function callAnthropic(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: any,
): Promise<any> {
  const anthropicModel = anthropicModelName(model);
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY required for Anthropic models');

  const schemaInstruction = `\n\nYou MUST respond with ONLY valid JSON matching this schema:\n${JSON.stringify(schema, null, 2)}\n\nNo markdown, no explanation — just the JSON object.`;

  const resp = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: anthropicModel,
      max_tokens: 8192,
      system: systemPrompt + schemaInstruction,
      messages: [{ role: 'user', content: userPrompt }],
    }),
  });

  if (!resp.ok) {
    throw new Error(`Anthropic error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as { content: { type: string; text: string }[] };
  const text = data.content.find(c => c.type === 'text')?.text || '{}';
  // Strip markdown code fence if present
  const cleaned = text.replace(/^```json?\s*\n?/, '').replace(/\n?```\s*$/, '').trim();
  return JSON.parse(cleaned);
}

// ── OpenAI support ──────────────────────────────────────────────────────
// Models prefixed with "openai:" are routed to the OpenAI Chat Completions API.
// e.g. "openai:gpt-4o-mini", "openai:gpt-4.1-nano"
// Uses OPENAI_API_KEY from environment.

function isOpenAIModel(model: string): boolean {
  return model.startsWith('openai:');
}

function openaiModelName(model: string): string {
  return model.replace('openai:', '');
}

async function callOpenAI(
  model: string,
  systemPrompt: string,
  userPrompt: string,
  schema: any,
): Promise<any> {
  const openaiModel = openaiModelName(model);
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY required for OpenAI models');

  const schemaInstruction = `\n\nYou MUST respond with valid JSON matching this exact schema:\n${JSON.stringify(schema, null, 2)}`;

  const resp = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: openaiModel,
      messages: [
        { role: 'system', content: systemPrompt + schemaInstruction },
        { role: 'user', content: userPrompt },
      ],
      response_format: { type: 'json_object' },
      temperature: 0.2,
    }),
  });

  if (!resp.ok) {
    throw new Error(`OpenAI error ${resp.status}: ${await resp.text()}`);
  }

  const data = await resp.json() as { choices: { message: { content: string } }[] };
  return JSON.parse(data.choices[0].message.content || '{}');
}

const V3_BOOST = `\n\n## CRITICAL: FEEDBACK QUALITY STANDARDS
Every feedback statement must reference EXACT text from the essay. No generic praise or criticism.
Name the specific craft move or error type. Check for factual errors and anachronisms.
Each annotation must end with a Socratic question referencing the student's actual words.
Before finalizing: verify every feedback cites specific text and every annotation has a Socratic question.`;

// Transition-specific coverage boost: ensures models produce a transition entry for EVERY pair
const TRANS_COVERAGE_BOOST = `\n\n## EXHAUSTIVE COVERAGE REQUIREMENT
You MUST produce one sentenceTransition entry for EVERY consecutive sentence pair in EVERY paragraph.
If a paragraph has N sentences, you must produce exactly N-1 sentenceTransition entries for it.
Do NOT skip any sentence pairs. Do NOT summarize multiple transitions into one entry.
Count: ¶1 has sentences S1..Sn → produce n-1 entries (S1→S2, S2→S3, ..., S(n-1)→Sn).
Repeat for every paragraph. Missing entries = FAILURE.`;

const ANALYSIS_CONFIG: Record<string, { systemPrompt: string; schema: any; buildPrompt: (content: string, assignmentPrompt: string, writingType: string) => string }> = {
  evaluation: {
    systemPrompt: SYSTEM_PROMPT,
    schema: EVALUATION_SCHEMA,
    buildPrompt: (content, assignmentPrompt, writingType) =>
      buildEvaluationPrompt({ assignmentPrompt, writingType, content }),
  },
  grammar: {
    systemPrompt: GRAMMAR_SYSTEM_PROMPT,
    schema: GRAMMAR_ANALYSIS_SCHEMA,
    buildPrompt: (content) => `Analyze the grammar of this student essay:\n\n${content}`,
  },
  transitions: {
    systemPrompt: TRANSITION_SYSTEM_PROMPT,
    schema: TRANSITION_SCHEMA,
    buildPrompt: (content) => {
      // Use production-style sentence formatting for better transition coverage
      const paragraphs = splitParagraphs(content);
      const sentences: Record<string, string[]> = {};
      let ki = 0;
      for (const para of paragraphs) {
        const sents = splitSentences(para).map(s => s.trim()).filter(s => s.length > 0);
        if (sents.length > 0) {
          sentences[String(ki++)] = sents;
        }
      }
      const formatted = formatSentencesForPrompt(sentences);
      return buildTransitionPrompt(formatted);
    },
  },
  promptAdherence: {
    systemPrompt: PROMPT_ADHERENCE_SYSTEM_PROMPT,
    schema: PROMPT_ANALYSIS_SCHEMA,
    buildPrompt: (content, assignmentPrompt) =>
      `Analyze how well this essay addresses the assignment prompt.\n\n## Assignment Prompt\n${assignmentPrompt}\n\n## Student Essay\n${content}`,
  },
  duplication: {
    systemPrompt: DUPLICATION_SYSTEM_PROMPT,
    schema: DUPLICATION_ANALYSIS_SCHEMA,
    buildPrompt: (content) => `Analyze this student essay for repeated ideas.\n\n${content}`,
  },
  coachSynthesis: {
    systemPrompt: COACH_SYNTHESIS_SYSTEM,
    schema: COACH_SYNTHESIS_SCHEMA,
    buildPrompt: () => '', // Built dynamically from other results
  },
};

const FIELD_MAP: Record<string, string> = {
  evaluation: 'evaluation',
  grammar: 'grammarAnalysis',
  transitions: 'transitionAnalysis',
  promptAdherence: 'promptAnalysis',
  duplication: 'duplicationAnalysis',
  coachSynthesis: 'coachSynthesis',
};

interface AnalysisConfig {
  model: string;
  v3Boost: boolean;
  transBoost?: boolean;  // Add transition coverage boost
}

interface Config {
  analyses: Record<string, AnalysisConfig>;
  groups: string[][];
}

async function runGroup(
  ai: any,
  group: string[],
  model: string,
  v3Boost: boolean,
  content: string,
  assignmentPrompt: string,
  writingType: string,
  priorResults: Record<string, any>,
  transBoost?: boolean,
): Promise<Record<string, any>> {
  if (group.length === 1) {
    // Single analysis — use its own prompt and schema
    const name = group[0];
    const cfg = ANALYSIS_CONFIG[name];
    let systemPrompt = cfg.systemPrompt;
    if (v3Boost) systemPrompt += V3_BOOST;
    if (transBoost && name === 'transitions') systemPrompt += TRANS_COVERAGE_BOOST;

    let userPrompt: string;
    if (name === 'coachSynthesis') {
      // Coach needs the other results as input
      userPrompt = `Draft number: 1\nHas assignment prompt: ${!!assignmentPrompt}\n\n`;
      userPrompt += `## Trait Evaluation\n${JSON.stringify(priorResults.evaluation || 'Not available')}\n\n`;
      userPrompt += `## Grammar Analysis\n${JSON.stringify(priorResults.grammarAnalysis || 'Not available')}\n\n`;
      userPrompt += `## Transition Analysis\n${JSON.stringify(priorResults.transitionAnalysis || 'Not available')}\n\n`;
      userPrompt += `## Prompt Adherence\n${JSON.stringify(priorResults.promptAnalysis || 'Not available')}\n\n`;
      userPrompt += `## Duplication Analysis\n${JSON.stringify(priorResults.duplicationAnalysis || 'Not available')}\n\n`;
      userPrompt += `Produce a coaching synthesis JSON. This is draft 1 — readiness must be "keep_going". improvements must be null.`;
    } else {
      userPrompt = cfg.buildPrompt(content, assignmentPrompt, writingType);
    }

    let result: any;
    if (isOllamaModel(model)) {
      result = await callOllama(model, systemPrompt, userPrompt, cfg.schema);
    } else if (isAnthropicModel(model)) {
      result = await callAnthropic(model, systemPrompt, userPrompt, cfg.schema);
    } else if (isOpenAIModel(model)) {
      result = await callOpenAI(model, systemPrompt, userPrompt, cfg.schema);
    } else {
      const resp = await ai.models.generateContent({
        model,
        contents: userPrompt,
        config: { systemInstruction: systemPrompt, responseMimeType: 'application/json', responseSchema: cfg.schema },
      });
      result = JSON.parse(resp.text || '{}');
    }
    return { [FIELD_MAP[name]]: result };
  } else {
    // Combined group — build merged prompt and schema
    const schemas: Record<string, any> = {};
    const systemParts: string[] = [];
    const promptParts: string[] = [];

    for (const name of group) {
      const cfg = ANALYSIS_CONFIG[name];
      systemParts.push(cfg.systemPrompt);
      schemas[FIELD_MAP[name]] = cfg.schema;

      if (name !== 'coachSynthesis') {
        promptParts.push(cfg.buildPrompt(content, assignmentPrompt, writingType));
      }
    }

    let systemPrompt = systemParts.join('\n\n');
    if (v3Boost) systemPrompt += V3_BOOST;
    if (transBoost && group.includes('transitions')) systemPrompt += TRANS_COVERAGE_BOOST;

    const mergedSchema = {
      type: 'object' as const,
      properties: schemas,
      required: Object.keys(schemas) as any,
    };

    let result: any;
    if (isOllamaModel(model)) {
      result = await callOllama(model, systemPrompt, promptParts.join('\n\n') || content, mergedSchema);
    } else if (isAnthropicModel(model)) {
      result = await callAnthropic(model, systemPrompt, promptParts.join('\n\n') || content, mergedSchema);
    } else if (isOpenAIModel(model)) {
      result = await callOpenAI(model, systemPrompt, promptParts.join('\n\n') || content, mergedSchema);
    } else {
      const resp = await ai.models.generateContent({
        model,
        contents: promptParts.join('\n\n') || content,
        config: { systemInstruction: systemPrompt, responseMimeType: 'application/json', responseSchema: mergedSchema },
      });
      result = JSON.parse(resp.text || '{}');
    }
    return result;
  }
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) { console.error('GEMINI_API_KEY required'); process.exit(1); }

  const configPath = resolve(__dirname, 'config.json');
  if (!existsSync(configPath)) { console.error('config.json not found'); process.exit(1); }

  const config: Config = JSON.parse(readFileSync(configPath, 'utf-8'));
  const ai = new GoogleGenAI({ apiKey });

  // Load production essays with full analyses
  const fullMode = process.argv.includes('--full');
  const prod = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));
  const complete = prod.filter((r: any) => r.draftNumber === 1 && r.transitionAnalysis && r.grammarAnalysis);
  const sample = fullMode
    ? complete
    : [complete[0], complete[Math.floor(complete.length / 2)], complete[complete.length - 1]];

  console.log(`Config: ${config.description || 'unnamed'}`);
  console.log(`Groups: ${config.groups.map(g => g.join('+')).join(' | ')}`);
  console.log(`Testing on ${sample.length} production essays\n`);

  let passed = 0;
  const failures: string[] = [];

  for (let i = 0; i < sample.length; i++) {
    const record = sample[i];
    const wc = record.content.split(/\s+/).length;
    const shortName = record.path.split('/').pop();
    console.log(`[${i + 1}/${sample.length}] ${shortName} (${wc}w)`);

    try {
      const allResults: Record<string, any> = {};

      // Run non-coach groups first (in parallel)
      const nonCoachGroups = config.groups.filter(g => !g.includes('coachSynthesis'));
      const coachGroup = config.groups.find(g => g.includes('coachSynthesis'));

      const groupResults = await Promise.all(nonCoachGroups.map(group => {
        const analysisName = group[0]; // Model comes from first analysis in group
        const { model, v3Boost, transBoost } = config.analyses[analysisName];
        return runGroup(ai, group, model, v3Boost, record.content, record.assignmentPrompt, record.writingType, allResults, transBoost);
      }));

      for (const r of groupResults) Object.assign(allResults, r);

      // Run coach synthesis last (needs other results)
      if (coachGroup) {
        const { model, v3Boost } = config.analyses.coachSynthesis;
        const coachResult = await runGroup(ai, coachGroup, model, v3Boost, record.content, record.assignmentPrompt, record.writingType, allResults);
        Object.assign(allResults, coachResult);
      }

      // Validate
      const checks = validateFullOutput(allResults, wc);
      const critFails = checks.filter(c => !c.pass && c.severity === 'critical');

      if (critFails.length === 0) {
        console.log(`  PASS`);
        passed++;
      } else {
        console.log(`  FAIL:`);
        for (const f of critFails) {
          console.log(`    ✗ ${f.name}: expected ${f.expected}, got ${f.actual}`);
          failures.push(`${shortName}: ${f.name}`);
        }
      }
    } catch (err) {
      console.log(`  ERROR: ${err instanceof Error ? err.message : err}`);
      failures.push(`${shortName}: error`);
    }

    if (i < sample.length - 1) await sleep(3000);
  }

  // Machine-readable output
  console.log(`\nPASS_RATE: ${passed}/${sample.length}`);
  console.log(`COST_ESTIMATE: ~$X.XX per essay`); // TODO: actual cost tracking
  console.log(`FAILURES: ${failures.length === 0 ? 'none' : failures.join(', ')}`);

  process.exit(passed === sample.length ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
