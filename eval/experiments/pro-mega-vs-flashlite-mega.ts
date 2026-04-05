/**
 * Pro mega-prompt vs Flash Lite mega-prompt, judged by Gemini 3 Pro.
 * The real question: can Flash Lite + mega-prompt match Pro + mega-prompt?
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';

const __dirname = dirname(new URL(import.meta.url).pathname);
const PRO = 'gemini-3.1-pro-preview';
const FLASH = 'gemini-3.1-flash-lite-preview';
const JUDGE = 'gemini-3-pro-preview';
const SAMPLE_SIZE = 15;

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const MEGA_SYSTEM = `You are an expert writing coach and analyst for high school students. You will perform a COMPLETE analysis of a student essay in a single pass.

${SYSTEM_PROMPT}

## ADDITIONAL: GRAMMAR ANALYSIS
After trait evaluation, analyze grammar: comma splices, run-ons, fragments, subject-verb agreement, pronoun reference, verb tense, parallel structure, punctuation, missing commas. Quote exact text, Socratic guidance. Severity: error/warning/pattern.

## ADDITIONAL: TRANSITION ANALYSIS
Rate paragraph-to-paragraph transitions as smooth/adequate/weak/missing with comments. Summarize overall flow.

## ADDITIONAL: COACH SYNTHESIS
Based on ALL analyses: readiness (keep_going/getting_close/almost_there/ready), 1-2 sentence coach note, recommended focus. Never "ready" for first drafts.`;

const MEGA_SCHEMA = {
  type: 'object' as const,
  properties: {
    evaluation: EVALUATION_SCHEMA,
    grammarAnalysis: {
      type: 'object' as const,
      properties: {
        errors: { type: 'array' as const, items: { type: 'object' as const, properties: { category: {type:'string' as const}, quotedText: {type:'string' as const}, comment: {type:'string' as const}, severity: {type:'string' as const} }, required: ['category','quotedText','comment','severity'] as const } },
        summary: { type: 'object' as const, properties: { totalErrors: {type:'number' as const}, overallComment: {type:'string' as const}, strengthAreas: {type:'array' as const,items:{type:'string' as const}}, priorityFixes: {type:'array' as const,items:{type:'string' as const}} }, required: ['totalErrors','overallComment','strengthAreas','priorityFixes'] as const }
      }, required: ['errors','summary'] as const
    },
    transitionAnalysis: {
      type: 'object' as const,
      properties: {
        paragraphTransitions: { type: 'array' as const, items: { type: 'object' as const, properties: { fromParagraph: {type:'number' as const}, toParagraph: {type:'number' as const}, quality: {type:'string' as const}, comment: {type:'string' as const} }, required: ['fromParagraph','toParagraph','quality','comment'] as const } },
        summary: { type: 'string' as const }
      }, required: ['paragraphTransitions','summary'] as const
    },
    coachSynthesis: {
      type: 'object' as const,
      properties: { readiness: {type:'string' as const}, coachNote: {type:'string' as const}, recommendedReport: {type:'string' as const} },
      required: ['readiness','coachNote','recommendedReport'] as const
    }
  },
  required: ['evaluation','grammarAnalysis','transitionAnalysis','coachSynthesis'] as const
};

const TRAITS = ['ideas','organization','voice','wordChoice','sentenceFluency','conventions','presentation'];

async function main() {
  const apiKey = process.env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });

  const production = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));
  const draft1s = production.filter((r: any) => r.draftNumber === 1);
  const step = Math.max(1, Math.floor(draft1s.length / SAMPLE_SIZE));
  const sample = draft1s.filter((_: any, i: number) => i % step === 0).slice(0, SAMPLE_SIZE);

  console.log(`Pro mega vs Flash Lite mega on ${sample.length} production essays`);
  console.log(`Judge: ${JUDGE}\n`);

  const results: any[] = [];

  for (let i = 0; i < sample.length; i++) {
    const record = sample[i];
    const shortPath = record.path.split('/').pop();
    console.log(`[${i+1}/${sample.length}] ${shortPath}`);

    const megaPrompt = `Perform a complete analysis of the following ${record.writingType} essay.\n\n## Assignment Prompt\n${record.assignmentPrompt}\n\n## Student Essay\n${record.content}\n\nAnalyze comprehensively: score all 6+1 traits, identify grammar issues, analyze transitions, provide coach synthesis. Return a single JSON object. Score each trait independently.`;

    // Run Pro and Flash Lite in parallel
    const [proResp, flashResp] = await Promise.all([
      ai.models.generateContent({ model: PRO, contents: megaPrompt, config: { systemInstruction: MEGA_SYSTEM, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
      ai.models.generateContent({ model: FLASH, contents: megaPrompt, config: { systemInstruction: MEGA_SYSTEM, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
    ]);

    const proResult = JSON.parse(proResp.text || '{}');
    const flashResult = JSON.parse(flashResp.text || '{}');
    const proEval = proResult.evaluation || {};
    const flashEval = flashResult.evaluation || {};

    // Score drift
    let drift = 0;
    for (const t of TRAITS) {
      drift += Math.abs((proEval.traits?.[t]?.score || 0) - (flashEval.traits?.[t]?.score || 0));
    }

    // Judge with Gemini 3 Pro
    const proFeedback = TRAITS.map(t => {
      const tr = proEval.traits?.[t];
      return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any) => '"' + (a.quotedText||'').substring(0,60) + '" — ' + (a.comment||'').substring(0,80)).join('\n') || 'none'}` : '';
    }).join('\n\n');

    const flashFeedback = TRAITS.map(t => {
      const tr = flashEval.traits?.[t];
      return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any) => '"' + (a.quotedText||'').substring(0,60) + '" — ' + (a.comment||'').substring(0,80)).join('\n') || 'none'}` : '';
    }).join('\n\n');

    let winner = 'error', rationale = '';
    try {
      const judgeResp = await ai.models.generateContent({
        model: JUDGE,
        contents: `Compare two essay feedback sets for a high school student. Which is more helpful for improving their writing? Consider specificity, actionability, and guiding questions.

ESSAY (excerpt): ${record.content.substring(0, 500)}...

--- FEEDBACK A ---
${proFeedback}

--- FEEDBACK B ---
${flashFeedback}

Return ONLY JSON: {"winner": "A" or "B" or "tie", "rationale": "one sentence"}`,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(judgeResp.text || '{}');
      winner = parsed.winner === 'A' ? 'pro' : parsed.winner === 'B' ? 'flash' : 'tie';
      rationale = parsed.rationale || '';
    } catch (e) {
      rationale = String(e);
    }

    console.log(`  drift=${(drift/7).toFixed(1)}, winner=${winner}: ${rationale.substring(0, 80)}`);
    results.push({ essay: shortPath, winner, rationale, scoreDrift: drift/7 });

    if (i < sample.length - 1) await sleep(3000);
  }

  // Summary
  const counts = { pro: 0, flash: 0, tie: 0, error: 0 };
  let totalDrift = 0;
  for (const r of results) { counts[r.winner as keyof typeof counts]++; totalDrift += r.scoreDrift; }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('     PRO MEGA vs FLASH LITE MEGA (judged by Gemini 3 Pro)');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Pairwise: Pro ${counts.pro}, Flash Lite ${counts.flash}, Tie ${counts.tie}, Error ${counts.error}`);
  console.log(`Average score drift: ${(totalDrift/results.length).toFixed(2)}`);
  console.log(`Flash win/tie rate: ${((counts.flash+counts.tie)/results.length*100).toFixed(0)}%`);
}

main().catch(err => { console.error(err); process.exit(1); });
