/**
 * Generate Pro mega-prompt baseline for autotune.
 * Runs Gemini Pro on 5 diverse calibration essays and saves results.
 * Run once; run-eval.ts reads the cached output instead of re-running Pro.
 *
 * Usage: GEMINI_API_KEY=xxx npx tsx generate-baseline.ts
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { MEGA_SYSTEM_PROMPT, MEGA_SCHEMA } from '../../functions/lib/functions/src/megaPrompt.js';

const __dirname = dirname(new URL(import.meta.url).pathname);
const PRO_MODEL = 'gemini-3.1-pro-preview';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// 5 diverse essays spanning the full quality range and multiple writing types
// Index into calibration.json:
//   0  = ACT score 1 (low argumentative)
//   4  = ACT score 5 (high argumentative)
//   6  = Grade 11 analytical (grade-level, no expected range)
//  10  = Oregon 3D printers A exceeds (high argumentative)
//  13  = Oregon 3D printers D doesnotmeet (low argumentative)
const ESSAY_INDICES = [0, 4, 6, 10, 13];

interface CalibrationEssay {
  filename: string;
  content: string;
  writingType: string;
  assignmentPrompt: string;
  expectedAvgScoreRange: [number, number] | null;
  scoreSource: string | null;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY environment variable is required');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });
  const calibration: CalibrationEssay[] = JSON.parse(
    readFileSync(resolve(__dirname, '../datasets/calibration.json'), 'utf-8')
  );

  const essays = ESSAY_INDICES.map(i => calibration[i]);
  const outPath = resolve(__dirname, 'baseline-pro.json');

  console.log(`Generating Pro baseline for ${essays.length} essays using ${PRO_MODEL}...`);
  console.log(`Essays: ${essays.map(e => e.filename).join(', ')}\n`);

  const results: Array<{
    index: number;
    filename: string;
    writingType: string;
    assignmentPrompt: string;
    scoreSource: string | null;
    expectedAvgScoreRange: [number, number] | null;
    proOutput: Record<string, unknown>;
    userPrompt: string;
  }> = [];

  for (let i = 0; i < essays.length; i++) {
    const essay = essays[i];
    const essayIndex = ESSAY_INDICES[i];
    console.log(`[${i + 1}/${essays.length}] ${essay.filename} (${essay.scoreSource || 'unscored'})...`);

    const userPrompt = `Perform a complete analysis of the following ${essay.writingType} essay.

## Assignment Prompt
${essay.assignmentPrompt}

## Student Essay
${essay.content}

Analyze comprehensively: score all 6+1 traits, identify grammar issues, analyze transitions, provide coach synthesis. Return a single JSON object. Score each trait independently.`;

    try {
      const resp = await ai.models.generateContent({
        model: PRO_MODEL,
        contents: userPrompt,
        config: {
          systemInstruction: MEGA_SYSTEM_PROMPT,
          responseMimeType: 'application/json',
          responseSchema: MEGA_SCHEMA as Record<string, unknown>,
        },
      });

      const proOutput = JSON.parse(resp.text || '{}');
      results.push({
        index: essayIndex,
        filename: essay.filename,
        writingType: essay.writingType,
        assignmentPrompt: essay.assignmentPrompt,
        scoreSource: essay.scoreSource,
        expectedAvgScoreRange: essay.expectedAvgScoreRange,
        proOutput,
        userPrompt,
      });

      // Show scores
      const traits = proOutput.evaluation?.traits || {};
      const scores = Object.entries(traits)
        .map(([t, v]: [string, any]) => `${t}=${v?.score}`)
        .join(', ');
      console.log(`  Scores: ${scores}`);
    } catch (err) {
      console.error(`  Error: ${err instanceof Error ? err.message : err}`);
      process.exit(1);
    }

    if (i < essays.length - 1) await sleep(2000);
  }

  writeFileSync(outPath, JSON.stringify(results, null, 2));
  console.log(`\nBaseline saved to ${outPath}`);
  console.log(`${results.length} essays cached. run-eval.ts will read this file.`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
