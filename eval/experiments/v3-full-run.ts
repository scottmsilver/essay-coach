/**
 * Full validation of v3-combined prompt on 15 production essays.
 * Flash Lite + v3 mega vs Pro baseline mega, judged by Gemini 3 Pro.
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';

const __dirname = dirname(new URL(import.meta.url).pathname);
const PRO = 'gemini-3.1-pro-preview';
const FLASH = 'gemini-3.1-flash-lite-preview';
const JUDGE = 'gemini-3-pro-preview';
const SAMPLE_SIZE = 15;
const TRAITS = ['ideas','organization','voice','wordChoice','sentenceFluency','conventions','presentation'];
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

const MEGA_SCHEMA = {
  type: 'object' as const,
  properties: {
    evaluation: EVALUATION_SCHEMA,
    grammarAnalysis: {
      type: 'object' as const,
      properties: {
        errors: { type: 'array' as const, items: { type: 'object' as const, properties: { category:{type:'string' as const}, quotedText:{type:'string' as const}, comment:{type:'string' as const}, severity:{type:'string' as const} }, required: ['category','quotedText','comment','severity'] as const } },
        summary: { type: 'object' as const, properties: { totalErrors:{type:'number' as const}, overallComment:{type:'string' as const}, strengthAreas:{type:'array' as const,items:{type:'string' as const}}, priorityFixes:{type:'array' as const,items:{type:'string' as const}} }, required: ['totalErrors','overallComment','strengthAreas','priorityFixes'] as const }
      }, required: ['errors','summary'] as const
    },
    transitionAnalysis: { type: 'object' as const, properties: { paragraphTransitions: { type: 'array' as const, items: { type: 'object' as const, properties: { fromParagraph:{type:'number' as const}, toParagraph:{type:'number' as const}, quality:{type:'string' as const}, comment:{type:'string' as const} }, required: ['fromParagraph','toParagraph','quality','comment'] as const } }, summary: { type: 'string' as const } }, required: ['paragraphTransitions','summary'] as const },
    coachSynthesis: { type: 'object' as const, properties: { readiness:{type:'string' as const}, coachNote:{type:'string' as const}, recommendedReport:{type:'string' as const} }, required: ['readiness','coachNote','recommendedReport'] as const }
  },
  required: ['evaluation','grammarAnalysis','transitionAnalysis','coachSynthesis'] as const
};

const V3_EXTRA = `## CRITICAL: FEEDBACK QUALITY STANDARDS
You are being evaluated on the SPECIFICITY and ACTIONABILITY of your feedback. Follow these rules strictly:

### Specificity
- Every feedback statement must reference EXACT text from the essay. No generic praise or criticism.
- Name the specific craft move (rhetorical question, anaphora, topic sentence, etc.) or the specific error type (comma splice, dangling modifier, anachronism).
- Check for factual errors, anachronisms, incorrect attributions, and logical fallacies. Call them out.

### Actionability
- Each annotation must end with a Socratic question the student can answer in one paragraph.
- Questions must reference the student's actual words: "Your phrase 'X' — [specific question]?"
- Never ask "How could this be better?" Instead: "What specific evidence would convince a skeptic of this claim?"

### Annotation Quality
- Quote the EXACT phrase, not a whole paragraph.
- When praising: explain WHY it works so the student can replicate the technique elsewhere.
- When critiquing: identify the EXACT problem AND guide toward the fix through questioning.
- Mix positive and negative — students need to know what's working so they do MORE of it.

### Self-Check Before Responding
Before finalizing your response, verify:
- Does every feedback sentence cite specific text? If not, add the citation.
- Does every annotation comment include a specific Socratic question? If not, add one.
- Have you checked for factual/historical accuracy in the student's claims?`;

function buildMegaSystem(extra: string): string {
  return `You are an expert writing coach and analyst for high school students. You will perform a COMPLETE analysis of a student essay in a single pass.

${SYSTEM_PROMPT}

${extra}

## ADDITIONAL: GRAMMAR ANALYSIS
After trait evaluation, analyze grammar: comma splices, run-ons, fragments, subject-verb agreement, pronoun reference, verb tense, parallel structure, punctuation, missing commas. Quote exact text, Socratic guidance. Severity: error/warning/pattern.

## ADDITIONAL: TRANSITION ANALYSIS
Rate paragraph-to-paragraph transitions as smooth/adequate/weak/missing with comments.

## ADDITIONAL: COACH SYNTHESIS
Based on ALL analyses: readiness (keep_going/getting_close/almost_there/ready), 1-2 sentence coach note, recommended focus.`;
}

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  const production = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));
  const draft1s = production.filter((r: any) => r.draftNumber === 1);
  const step = Math.max(1, Math.floor(draft1s.length / SAMPLE_SIZE));
  const sample = draft1s.filter((_: any, i: number) => i % step === 0).slice(0, SAMPLE_SIZE);

  const proSystem = buildMegaSystem('');
  const flashSystem = buildMegaSystem(V3_EXTRA);

  console.log(`Flash Lite + v3-combined vs Pro baseline on ${sample.length} essays`);
  console.log(`Judge: ${JUDGE}\n`);

  let proWins = 0, flashWins = 0, ties = 0, totalDrift = 0;

  for (let i = 0; i < sample.length; i++) {
    const record = sample[i];
    const shortPath = record.path.split('/').pop();
    const megaPrompt = `Perform a complete analysis of the following ${record.writingType} essay.\n\n## Assignment Prompt\n${record.assignmentPrompt}\n\n## Student Essay\n${record.content}\n\nAnalyze comprehensively. Score each trait independently.`;

    const [proResp, flashResp] = await Promise.all([
      ai.models.generateContent({ model: PRO, contents: megaPrompt, config: { systemInstruction: proSystem, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
      ai.models.generateContent({ model: FLASH, contents: megaPrompt, config: { systemInstruction: flashSystem, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
    ]);

    const proEval = JSON.parse(proResp.text || '{}').evaluation || {};
    const flashEval = JSON.parse(flashResp.text || '{}').evaluation || {};

    let drift = 0;
    for (const t of TRAITS) drift += Math.abs((proEval.traits?.[t]?.score || 0) - (flashEval.traits?.[t]?.score || 0));
    totalDrift += drift / 7;

    const proFb = TRAITS.map(t => { const tr = proEval.traits?.[t]; return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any)=> '"'+(a.quotedText||'').substring(0,50)+'" — '+(a.comment||'').substring(0,80)).join('\n')||'none'}` : ''; }).join('\n\n');
    const flashFb = TRAITS.map(t => { const tr = flashEval.traits?.[t]; return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any)=> '"'+(a.quotedText||'').substring(0,50)+'" — '+(a.comment||'').substring(0,80)).join('\n')||'none'}` : ''; }).join('\n\n');

    try {
      const judgeResp = await ai.models.generateContent({
        model: JUDGE,
        contents: `Compare two essay feedback sets. Which is more helpful for a student improving their writing? Consider specificity, actionability, guiding questions.\n\nESSAY (excerpt): ${record.content.substring(0,400)}...\n\n--- FEEDBACK A ---\n${proFb}\n\n--- FEEDBACK B ---\n${flashFb}\n\nReturn JSON: {"winner": "A" or "B" or "tie", "rationale": "one sentence"}`,
        config: { responseMimeType: 'application/json' },
      });
      const parsed = JSON.parse(judgeResp.text || '{}');
      const winner = parsed.winner === 'A' ? 'pro' : parsed.winner === 'B' ? 'flash' : 'tie';
      if (winner === 'pro') proWins++;
      else if (winner === 'flash') flashWins++;
      else ties++;
      console.log(`[${i+1}/${sample.length}] ${shortPath}: drift=${(drift/7).toFixed(1)}, winner=${winner}: ${(parsed.rationale||'').substring(0,70)}`);
    } catch (e) {
      console.log(`[${i+1}/${sample.length}] ${shortPath}: error`);
    }

    if (i < sample.length - 1) await sleep(3000);
  }

  const flashRate = (flashWins + ties) / sample.length;
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`RESULT: Pro ${proWins}, Flash+v3 ${flashWins}, Tie ${ties}`);
  console.log(`Flash win/tie rate: ${(flashRate*100).toFixed(0)}% ${flashRate >= 0.4 ? 'PASS' : 'FAIL'} (threshold >= 40%)`);
  console.log(`Average score drift: ${(totalDrift/sample.length).toFixed(2)}`);
  console.log(`${'═'.repeat(60)}`);
}

main().catch(err => { console.error(err); process.exit(1); });
