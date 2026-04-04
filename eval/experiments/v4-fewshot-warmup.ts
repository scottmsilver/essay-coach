/**
 * Test two more prompt improvements on Flash Lite:
 * v4: few-shot examples from Pro's best outputs
 * v5: essay-specific warm-up step
 * v6: both combined
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

const V3_BASE = `## CRITICAL: FEEDBACK QUALITY STANDARDS
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

const FEWSHOT = `
## EXAMPLES OF EXCELLENT FEEDBACK

Here are examples of the quality standard your feedback must meet:

### Example: Ideas trait, score 5
Feedback: "Your historical research is exceptional. You don't just list facts; you synthesize complex 19th-century political dynamics into a coherent philosophy of executive power."
Annotation: { quotedText: "unbought and unbossed", comment: "This is famously Shirley Chisholm's 1972 campaign slogan! While it sounds great, it's highly anachronistic for an 1880s statesman writing a formal letter. What 19th-century phrase would capture the same idea of political independence?" }

### Example: Word Choice trait, score 4  
Feedback: "You deploy period-appropriate vocabulary with great skill, though a few modern idioms break the 19th-century illusion."
Annotation: { quotedText: "clean up this mess", comment: "This phrase is too casual and modern for an 1880s statesman writing a formal letter. What 19th-century phrasing would convey the same frustration with more gravitas?" }

### Example: Voice trait, score 3
Feedback: "Your tone is suitably academic but feels distant. You sound like you're fulfilling an assignment rather than passionately arguing a point."
Annotation: { quotedText: "Mary Shelley's Frankenstein is a novel that explores the profound consequences", comment: "This is a very safe, standard opening. How could you hook the reader with a striking thought about humanity's relationship with creation — something that makes them WANT to keep reading?" }

Notice the pattern: specific text cited, specific craft move named, specific Socratic question asked.`;

const WARMUP = `
## BEFORE ANALYZING: WARM-UP STEP
Before beginning your full analysis, first identify:
1. The 3 most notable STRENGTHS of this essay (specific passages that work well and why)
2. The 3 most notable WEAKNESSES (specific passages that need work and why)
3. Any factual errors, anachronisms, or logical fallacies you notice

Use these observations to ground your trait-by-trait analysis. Every strength and weakness you identified should appear in your annotations.`;

const VARIANTS: Array<{name: string, extra: string}> = [
  { name: 'v3-baseline', extra: V3_BASE },
  { name: 'v4-fewshot', extra: V3_BASE + FEWSHOT },
  { name: 'v5-warmup', extra: V3_BASE + WARMUP },
  { name: 'v6-fewshot+warmup', extra: V3_BASE + FEWSHOT + WARMUP },
];

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
  const indices = [0, Math.floor(draft1s.length*0.25), Math.floor(draft1s.length*0.5), Math.floor(draft1s.length*0.75), draft1s.length-1];
  const sample = indices.map(i => draft1s[i]);

  const proSystem = buildMegaSystem('');

  console.log(`Testing ${VARIANTS.length} variants on ${sample.length} essays\n`);

  const allResults: Array<{variant:string, proWins:number, flashWins:number, ties:number, avgDrift:number}> = [];

  for (const variant of VARIANTS) {
    console.log(`\n${'═'.repeat(50)}`);
    console.log(`VARIANT: ${variant.name}`);
    console.log(`${'═'.repeat(50)}\n`);

    const flashSystem = buildMegaSystem(variant.extra);
    let proWins=0, flashWins=0, ties=0, totalDrift=0;

    for (let i = 0; i < sample.length; i++) {
      const record = sample[i];
      const megaPrompt = `Perform a complete analysis of the following ${record.writingType} essay.\n\n## Assignment Prompt\n${record.assignmentPrompt}\n\n## Student Essay\n${record.content}\n\nAnalyze comprehensively. Score each trait independently.`;

      const [proResp, flashResp] = await Promise.all([
        ai.models.generateContent({ model: PRO, contents: megaPrompt, config: { systemInstruction: proSystem, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
        ai.models.generateContent({ model: FLASH, contents: megaPrompt, config: { systemInstruction: flashSystem, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
      ]);

      const proEval = JSON.parse(proResp.text || '{}').evaluation || {};
      const flashEval = JSON.parse(flashResp.text || '{}').evaluation || {};

      let drift = 0;
      for (const t of TRAITS) drift += Math.abs((proEval.traits?.[t]?.score||0) - (flashEval.traits?.[t]?.score||0));
      totalDrift += drift/7;

      const proFb = TRAITS.map(t => { const tr=proEval.traits?.[t]; return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any)=>'"'+(a.quotedText||'').substring(0,50)+'" — '+(a.comment||'').substring(0,80)).join('\n')||'none'}` : ''; }).join('\n\n');
      const flashFb = TRAITS.map(t => { const tr=flashEval.traits?.[t]; return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any)=>'"'+(a.quotedText||'').substring(0,50)+'" — '+(a.comment||'').substring(0,80)).join('\n')||'none'}` : ''; }).join('\n\n');

      try {
        const judgeResp = await ai.models.generateContent({
          model: JUDGE,
          contents: `Compare two essay feedback sets. Which is more helpful for a student? Consider specificity, actionability, guiding questions.\n\nESSAY: ${record.content.substring(0,400)}...\n\n--- FEEDBACK A ---\n${proFb}\n\n--- FEEDBACK B ---\n${flashFb}\n\nReturn JSON: {"winner": "A" or "B" or "tie", "rationale": "one sentence"}`,
          config: { responseMimeType: 'application/json' },
        });
        const parsed = JSON.parse(judgeResp.text || '{}');
        const winner = parsed.winner==='A' ? 'pro' : parsed.winner==='B' ? 'flash' : 'tie';
        if (winner==='pro') proWins++; else if (winner==='flash') flashWins++; else ties++;
        console.log(`  [${i+1}] ${winner}: ${(parsed.rationale||'').substring(0,70)}`);
      } catch(e) { console.log(`  [${i+1}] error`); }

      await sleep(3000);
    }

    console.log(`\n  Result: Pro ${proWins}, Flash ${flashWins}, Tie ${ties} | Flash%: ${((flashWins+ties)/sample.length*100).toFixed(0)}% | Drift: ${(totalDrift/sample.length).toFixed(2)}`);
    allResults.push({ variant: variant.name, proWins, flashWins, ties, avgDrift: totalDrift/sample.length });
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('VARIANT COMPARISON');
  console.log(`${'═'.repeat(50)}\n`);
  console.log('Variant'.padEnd(22), 'Pro'.padEnd(5), 'Flash'.padEnd(7), 'Tie'.padEnd(5), 'Flash%'.padEnd(8), 'Drift');
  for (const r of allResults) {
    console.log(r.variant.padEnd(22), String(r.proWins).padEnd(5), String(r.flashWins).padEnd(7), String(r.ties).padEnd(5), (((r.flashWins+r.ties)/sample.length*100).toFixed(0)+'%').padEnd(8), r.avgDrift.toFixed(2));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
