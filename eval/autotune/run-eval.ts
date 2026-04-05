/**
 * Autotune evaluation harness.
 * Runs Flash Lite mega-prompt on 5 calibration essays, judges against
 * cached Pro baseline using Gemini 3 Pro.
 *
 * Outputs a single aggregate score to stdout: SCORE: 0.XX
 * The tuning agent reads this score to decide keep/discard.
 *
 * Usage: GEMINI_API_KEY=xxx npx tsx run-eval.ts
 *
 * DO NOT MODIFY THIS FILE during tuning iterations.
 * The agent only edits functions/src/prompt.ts.
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(new URL(import.meta.url).pathname);
const FLASH_MODEL = 'gemini-3.1-flash-lite-preview';
const JUDGE_MODEL = 'gemini-3-pro-preview';
const TRAITS = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

interface BaselineEntry {
  index: number;
  filename: string;
  writingType: string;
  assignmentPrompt: string;
  scoreSource: string | null;
  expectedAvgScoreRange: [number, number] | null;
  proOutput: Record<string, any>;
  userPrompt: string;
}

function formatFeedback(evalOutput: Record<string, any>): string {
  const traits = evalOutput?.evaluation?.traits || evalOutput?.traits || {};
  return TRAITS.map(t => {
    const tr = traits[t];
    if (!tr) return '';
    const annotations = tr.annotations?.map((a: any) =>
      `"${(a.quotedText || '').substring(0, 60)}" -- ${(a.comment || '').substring(0, 100)}`
    ).join('\n') || 'none';
    return `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations:\n${annotations}`;
  }).filter(Boolean).join('\n\n');
}

async function callJudge(
  ai: any,
  essayExcerpt: string,
  proFeedback: string,
  flashFeedback: string,
  retries = 2
): Promise<{ winner: 'pro' | 'flash' | 'tie'; rationale: string }> {
  // Randomize A/B assignment to avoid position bias
  const proIsA = Math.random() < 0.5;
  const feedbackA = proIsA ? proFeedback : flashFeedback;
  const feedbackB = proIsA ? flashFeedback : proFeedback;

  const prompt = `You are judging the quality of essay feedback for a high school student. Compare these two feedback sets and decide which is MORE HELPFUL for the student's writing improvement.

Consider:
1. SPECIFICITY: Does feedback cite exact text from the essay? Does it name specific craft moves or error types?
2. ACTIONABILITY: Does each annotation include a concrete Socratic question the student can act on?
3. ACCURACY: Are scores well-calibrated? Does the feedback catch factual errors, anachronisms, or logical issues?
4. BALANCE: Does it identify both strengths and weaknesses?

ESSAY EXCERPT:
${essayExcerpt}

--- FEEDBACK A ---
${feedbackA}

--- FEEDBACK B ---
${feedbackB}

Return ONLY JSON: {"winner": "A" or "B" or "tie", "rationale": "one sentence explaining your choice"}`;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await ai.models.generateContent({
        model: JUDGE_MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(resp.text || '{}');
      let winner: 'pro' | 'flash' | 'tie';
      if (parsed.winner === 'A') {
        winner = proIsA ? 'pro' : 'flash';
      } else if (parsed.winner === 'B') {
        winner = proIsA ? 'flash' : 'pro';
      } else {
        winner = 'tie';
      }
      return { winner, rationale: parsed.rationale || '' };
    } catch (err) {
      if (attempt < retries) {
        await sleep(1000 * Math.pow(2, attempt));
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is required');
    process.exit(1);
  }

  const baselinePath = resolve(__dirname, 'baseline-pro.json');
  if (!existsSync(baselinePath)) {
    console.error('Error: baseline-pro.json not found. Run generate-baseline.ts first.');
    process.exit(1);
  }

  // Dynamic import of mega-prompt so we always get the latest compiled version.
  // The agent edits functions/src/prompt.ts, then runs `cd functions && npx tsc`
  // before calling this script. We invalidate the module cache to pick up changes.
  const megaPromptPath = resolve(__dirname, '../../functions/lib/functions/src/megaPrompt.js');
  if (!existsSync(megaPromptPath)) {
    console.error('Error: compiled megaPrompt.js not found. Run `cd functions && npx tsc` first.');
    process.exit(1);
  }

  // Cache-bust: append query param to force re-import
  const cacheBuster = `?t=${Date.now()}`;
  const { MEGA_SYSTEM_PROMPT, MEGA_SCHEMA } = await import(megaPromptPath + cacheBuster);

  const ai = new GoogleGenAI({ apiKey });
  const baseline: BaselineEntry[] = JSON.parse(readFileSync(baselinePath, 'utf-8'));

  console.log(`Evaluating Flash Lite against Pro baseline on ${baseline.length} essays...`);
  console.log(`Flash: ${FLASH_MODEL} | Judge: ${JUDGE_MODEL}\n`);

  const results: Array<{
    filename: string;
    winner: string;
    rationale: string;
    score: number;
  }> = [];

  for (let i = 0; i < baseline.length; i++) {
    const entry = baseline[i];
    console.log(`[${i + 1}/${baseline.length}] ${entry.filename} (${entry.scoreSource || 'unscored'})`);

    try {
      // Run Flash Lite with current prompt
      const flashResp = await ai.models.generateContent({
        model: FLASH_MODEL,
        contents: entry.userPrompt,
        config: {
          systemInstruction: MEGA_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: MEGA_SCHEMA as Record<string, unknown>,
        },
      });

      const flashOutput = JSON.parse(flashResp.text || '{}');
      const proFeedback = formatFeedback(entry.proOutput);
      const flashFeedback = formatFeedback(flashOutput);

      // Extract essay excerpt from the user prompt (after "## Student Essay\n")
      const essayMatch = entry.userPrompt.match(/## Student Essay\n([\s\S]*?)(?:\n\nAnalyze|$)/);
      const essayExcerpt = (essayMatch?.[1] || '').substring(0, 600);

      // Judge
      const judgment = await callJudge(ai, essayExcerpt, proFeedback, flashFeedback);
      const essayScore = judgment.winner === 'flash' ? 1.0 : judgment.winner === 'tie' ? 0.5 : 0.0;

      results.push({
        filename: entry.filename,
        winner: judgment.winner,
        rationale: judgment.rationale,
        score: essayScore,
      });

      console.log(`  ${judgment.winner} (${essayScore}) -- ${judgment.rationale.substring(0, 80)}`);
    } catch (err) {
      console.error(`  Error: ${err instanceof Error ? err.message : err}`);
      // Count errors as pro wins (conservative)
      results.push({
        filename: entry.filename,
        winner: 'error',
        rationale: String(err),
        score: 0.0,
      });
    }

    if (i < baseline.length - 1) await sleep(2000);
  }

  // Aggregate
  const aggregate = results.reduce((sum, r) => sum + r.score, 0) / results.length;

  console.log('\n' + '='.repeat(60));
  console.log('PER-ESSAY BREAKDOWN');
  console.log('='.repeat(60));
  for (const r of results) {
    console.log(`  ${r.filename.padEnd(40)} ${r.winner.padEnd(6)} (${r.score.toFixed(1)}) ${r.rationale.substring(0, 60)}`);
  }

  const wins = results.filter(r => r.winner === 'flash').length;
  const ties = results.filter(r => r.winner === 'tie').length;
  const losses = results.filter(r => r.winner === 'pro').length;
  const errors = results.filter(r => r.winner === 'error').length;

  console.log('\n' + '='.repeat(60));
  console.log(`Flash wins: ${wins}, Ties: ${ties}, Pro wins: ${losses}, Errors: ${errors}`);
  console.log('='.repeat(60));
  console.log(`\nSCORE: ${aggregate.toFixed(2)}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
