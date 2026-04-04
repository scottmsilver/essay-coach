/**
 * Compare mega-prompt vs separate-call evaluation quality
 * using production essays and the Claude judge.
 *
 * Runs a sample of production essays through both approaches,
 * then has Claude judge which feedback is better.
 */

import { GoogleGenAI } from '@google/genai';
import Anthropic from '@anthropic-ai/sdk';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';

const __dirname = dirname(new URL(import.meta.url).pathname);
const MODEL = 'gemini-3.1-pro-preview';
const JUDGE_MODEL = 'claude-haiku-4-5-20251001';
const SAMPLE_SIZE = 15; // 15 production essays, diverse

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

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function main() {
  const geminiKey = process.env.GEMINI_API_KEY!;
  const anthropicKey = process.env.ANTHROPIC_API_KEY!;
  const ai = new GoogleGenAI({ apiKey: geminiKey });
  const anthropic = new Anthropic({ apiKey: anthropicKey });

  // Load production data, sample diverse essays
  const production = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));

  // Take every Nth essay for diversity, only draft 1 (simpler comparison)
  const draft1s = production.filter((r: any) => r.draftNumber === 1);
  const step = Math.max(1, Math.floor(draft1s.length / SAMPLE_SIZE));
  const sample = draft1s.filter((_: any, i: number) => i % step === 0).slice(0, SAMPLE_SIZE);

  console.log(`Comparing mega-prompt vs separate on ${sample.length} production essays\n`);

  const results: Array<{essay: string, pairwise: string, rationale: string, scoreDrift: number}> = [];

  for (let i = 0; i < sample.length; i++) {
    const record = sample[i];
    const shortPath = record.path.split('/').pop();
    console.log(`[${i+1}/${sample.length}] ${shortPath}`);

    // Run both in parallel
    const evalPrompt = buildEvaluationPrompt({
      assignmentPrompt: record.assignmentPrompt,
      writingType: record.writingType,
      content: record.content,
    });
    const megaPrompt = `Perform a complete analysis of the following ${record.writingType} essay.\n\n## Assignment Prompt\n${record.assignmentPrompt}\n\n## Student Essay\n${record.content}\n\nAnalyze comprehensively: score all 6+1 traits, identify grammar issues, analyze transitions, provide coach synthesis. Return a single JSON object. Score each trait independently.`;

    const [sepResp, megaResp] = await Promise.all([
      ai.models.generateContent({ model: MODEL, contents: evalPrompt, config: { systemInstruction: SYSTEM_PROMPT, responseMimeType: 'application/json', responseSchema: EVALUATION_SCHEMA } }),
      ai.models.generateContent({ model: MODEL, contents: megaPrompt, config: { systemInstruction: MEGA_SYSTEM, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
    ]);

    const sepResult = JSON.parse(sepResp.text || '{}');
    const megaResult = JSON.parse(megaResp.text || '{}');
    const megaEval = megaResult.evaluation || {};

    // Score drift
    const traits = ['ideas','organization','voice','wordChoice','sentenceFluency','conventions','presentation'];
    let drift = 0;
    for (const t of traits) {
      const s = sepResult.traits?.[t]?.score || 0;
      const m = megaEval.traits?.[t]?.score || 0;
      drift += Math.abs(m - s);
    }
    const avgDrift = drift / 7;

    // Pairwise judge: which evaluation feedback is better for the student?
    const sepFeedback = traits.map(t => {
      const tr = sepResult.traits?.[t];
      return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any) => `"${a.quotedText}" — ${a.comment}`).join('\n') || 'none'}` : '';
    }).join('\n\n');

    const megaFeedback = traits.map(t => {
      const tr = megaEval.traits?.[t];
      return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any) => `"${a.quotedText}" — ${a.comment}`).join('\n') || 'none'}` : '';
    }).join('\n\n');

    let pairwise = 'error';
    let rationale = '';
    try {
      const judgeResp = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 200,
        messages: [{ role: 'user', content: `You are comparing two sets of essay feedback for the same student essay. Which is more helpful for a student trying to improve their writing?

Consider: Does the feedback reference specific parts of the essay? Does it give actionable next steps? Do annotations ask guiding questions?

ESSAY (first 500 chars): ${record.content.substring(0, 500)}...

--- FEEDBACK A ---
${sepFeedback}

--- FEEDBACK B ---
${megaFeedback}

Respond with ONLY JSON: {"winner": "A" or "B" or "tie", "rationale": "one sentence"}` }],
      });
      const text = judgeResp.content[0].type === 'text' ? judgeResp.content[0].text : '';
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        pairwise = parsed.winner === 'A' ? 'separate' : parsed.winner === 'B' ? 'mega' : 'tie';
        rationale = parsed.rationale;
      }
    } catch (e) {
      pairwise = 'error';
      rationale = String(e);
    }

    console.log(`  drift=${avgDrift.toFixed(1)}, winner=${pairwise}: ${rationale.substring(0, 80)}`);
    results.push({ essay: shortPath, pairwise, rationale, scoreDrift: avgDrift });

    // Small delay to avoid rate limits
    if (i < sample.length - 1) await sleep(2000);
  }

  // Summary
  const counts = { separate: 0, mega: 0, tie: 0, error: 0 };
  let totalDrift = 0;
  for (const r of results) {
    counts[r.pairwise as keyof typeof counts]++;
    totalDrift += r.scoreDrift;
  }

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('              MEGA-PROMPT vs SEPARATE COMPARISON');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Pairwise: Separate wins ${counts.separate}, Mega wins ${counts.mega}, Tie ${counts.tie}, Error ${counts.error}`);
  console.log(`Average score drift: ${(totalDrift / results.length).toFixed(2)}`);
  console.log(`\nVerdict: ${counts.mega >= counts.separate ? 'Mega-prompt is viable — feedback quality is equivalent or better' : 'Separate calls produce better feedback — mega-prompt needs work'}`);
}

main().catch(err => { console.error(err); process.exit(1); });
