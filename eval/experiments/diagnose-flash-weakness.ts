/**
 * Side-by-side comparison of Pro mega vs Flash Lite mega feedback
 * to identify specific patterns in Flash Lite's weaknesses.
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';

const __dirname = dirname(new URL(import.meta.url).pathname);

const MEGA_SYSTEM = `You are an expert writing coach and analyst for high school students. You will perform a COMPLETE analysis of a student essay in a single pass.

${SYSTEM_PROMPT}

## ADDITIONAL: GRAMMAR ANALYSIS
After trait evaluation, analyze grammar: comma splices, run-ons, fragments, subject-verb agreement, pronoun reference, verb tense, parallel structure, punctuation, missing commas. Quote exact text, Socratic guidance. Severity: error/warning/pattern.

## ADDITIONAL: TRANSITION ANALYSIS
Rate paragraph-to-paragraph transitions as smooth/adequate/weak/missing with comments.

## ADDITIONAL: COACH SYNTHESIS
Based on ALL analyses: readiness (keep_going/getting_close/almost_there/ready), 1-2 sentence coach note, recommended focus.`;

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
    transitionAnalysis: { type: 'object' as const, properties: { paragraphTransitions: { type: 'array' as const, items: { type: 'object' as const, properties: { fromParagraph:{type:'number' as const}, toParagraph:{type:'number' as const}, quality:{type:'string' as const}, comment:{type:'string' as const} }, required: ['fromParagraph','toParagraph','quality','comment'] as const } }, summary: { type: 'string' as const } }, required: ['paragraphTransitions','summary'] as const },
    coachSynthesis: { type: 'object' as const, properties: { readiness:{type:'string' as const}, coachNote:{type:'string' as const}, recommendedReport:{type:'string' as const} }, required: ['readiness','coachNote','recommendedReport'] as const }
  },
  required: ['evaluation','grammarAnalysis','transitionAnalysis','coachSynthesis'] as const
};

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const production = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));
  // Pick 3 diverse essays
  const draft1s = production.filter((r: any) => r.draftNumber === 1);
  const essays = [draft1s[0], draft1s[Math.floor(draft1s.length/2)], draft1s[draft1s.length-1]];

  for (const record of essays) {
    const megaPrompt = `Perform a complete analysis of the following ${record.writingType} essay.\n\n## Assignment Prompt\n${record.assignmentPrompt}\n\n## Student Essay\n${record.content}\n\nAnalyze comprehensively. Score each trait independently.`;

    const [proResp, flashResp] = await Promise.all([
      ai.models.generateContent({ model: 'gemini-3.1-pro-preview', contents: megaPrompt, config: { systemInstruction: MEGA_SYSTEM, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
      ai.models.generateContent({ model: 'gemini-3.1-flash-lite-preview', contents: megaPrompt, config: { systemInstruction: MEGA_SYSTEM, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
    ]);

    const pro = JSON.parse(proResp.text || '{}').evaluation || {};
    const flash = JSON.parse(flashResp.text || '{}').evaluation || {};

    console.log(`\n${'═'.repeat(70)}`);
    console.log(`ESSAY: ${record.path.split('/').pop()} (${record.content.split(/\s+/).length} words)`);
    console.log(`${'═'.repeat(70)}`);

    // Show side-by-side for 2 traits where differences are most visible
    for (const t of ['ideas', 'voice', 'wordChoice']) {
      const p = pro.traits?.[t];
      const f = flash.traits?.[t];
      if (!p || !f) continue;

      console.log(`\n─── ${t.toUpperCase()} (Pro=${p.score}, Flash=${f.score}) ───`);
      console.log(`\nPRO feedback: ${p.feedback}`);
      console.log(`PRO annotations:`);
      for (const a of (p.annotations || [])) {
        console.log(`  → "${a.quotedText.substring(0, 60)}..." — ${a.comment.substring(0, 100)}`);
      }
      console.log(`\nFLASH feedback: ${f.feedback}`);
      console.log(`FLASH annotations:`);
      for (const a of (f.annotations || [])) {
        console.log(`  → "${a.quotedText.substring(0, 60)}..." — ${a.comment.substring(0, 100)}`);
      }
    }
  }
}
main().catch(err => { console.error(err); process.exit(1); });
