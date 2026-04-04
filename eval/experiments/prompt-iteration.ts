/**
 * Iterative prompt tuning for Flash Lite.
 * 
 * Loop: try a prompt variation → judge vs Pro → analyze failures → improve prompt
 * Uses Gemini 3 Pro as judge, 5 diverse production essays per iteration.
 */
import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { SYSTEM_PROMPT } from '../../functions/lib/functions/src/prompt.js';
import { EVALUATION_SCHEMA } from '../../functions/lib/functions/src/gemini.js';

const __dirname = dirname(new URL(import.meta.url).pathname);
const PRO = 'gemini-3.1-pro-preview';
const FLASH = 'gemini-3.1-flash-lite-preview';
const JUDGE = 'gemini-3-pro-preview';

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

const TRAITS = ['ideas','organization','voice','wordChoice','sentenceFluency','conventions','presentation'];

// ── Prompt variations to test ───────────────────────────────────────────

function buildMegaSystem(extraInstructions: string): string {
  return `You are an expert writing coach and analyst for high school students. You will perform a COMPLETE analysis of a student essay in a single pass.

${SYSTEM_PROMPT}

${extraInstructions}

## ADDITIONAL: GRAMMAR ANALYSIS
After trait evaluation, analyze grammar: comma splices, run-ons, fragments, subject-verb agreement, pronoun reference, verb tense, parallel structure, punctuation, missing commas. Quote exact text, Socratic guidance. Severity: error/warning/pattern.

## ADDITIONAL: TRANSITION ANALYSIS
Rate paragraph-to-paragraph transitions as smooth/adequate/weak/missing with comments.

## ADDITIONAL: COACH SYNTHESIS
Based on ALL analyses: readiness (keep_going/getting_close/almost_there/ready), 1-2 sentence coach note, recommended focus.`;
}

const PROMPT_VARIANTS: Array<{name: string, extra: string}> = [
  {
    name: 'v0-baseline',
    extra: '', // No extra instructions — baseline Flash Lite mega
  },
  {
    name: 'v1-specificity-boost',
    extra: `## CRITICAL: SPECIFICITY REQUIREMENTS
Your feedback MUST meet these specificity standards:
- Every feedback sentence must reference a SPECIFIC passage, word, phrase, or structural element from the essay. Generic feedback like "good vocabulary" or "needs more detail" is UNACCEPTABLE.
- Every annotation comment must include a SPECIFIC Socratic question that references the student's actual words. Not "Can you be more specific?" but "Your phrase 'many things' — what are those things specifically? Name one concrete example."
- When praising, name the EXACT craft move: not "good word choice" but "'saturated' creates visceral imagery of excess — where else could a single verb carry this weight?"
- When critiquing, identify the EXACT problem: not "this is vague" but "'He did stuff' — what stuff? What specific action changed the outcome?"
- Check for historical, factual, or logical errors in the student's claims. If you find anachronisms, incorrect attributions, or faulty reasoning, call them out specifically.`,
  },
  {
    name: 'v2-annotation-depth',
    extra: `## CRITICAL: ANNOTATION QUALITY STANDARDS
Each annotation is the most valuable part of your evaluation. They must be EXCEPTIONAL:

1. QUOTE PRECISION: Quote the EXACT passage that demonstrates the strength or weakness. Not a whole paragraph — the specific phrase, sentence, or word.

2. CRAFT IDENTIFICATION: Name the specific writing technique at work (or missing). Examples: "rhetorical question followed by answer", "anaphora", "topic sentence that previews the paragraph's argument", "dangling modifier", "comma splice masking a run-on".

3. SOCRATIC DEPTH: Your question must be specific enough that the student could answer it in one paragraph. Bad: "How could this be better?" Good: "You claim machines 'take people's jobs' — which specific industry has lost the most jobs to automation, and what happened to those workers?"

4. ERROR DETECTION: Actively look for factual errors, anachronisms, misattributions, and logical fallacies. A student who attributes a 1972 slogan to an 1880s politician needs to know. A student who claims "all scientists agree" needs to be challenged.

5. PRAISE WITH PURPOSE: When something works, explain WHY it works so the student can replicate it. "This metaphor works because it connects the abstract concept of freedom to the physical sensation of breathing — sensory details make abstract ideas concrete."`,
  },
  {
    name: 'v3-combined',
    extra: `## CRITICAL: FEEDBACK QUALITY STANDARDS
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
- Have you checked for factual/historical accuracy in the student's claims?`,
  },
];

// ── Main ────────────────────────────────────────────────────────────────

async function main() {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

  const production = JSON.parse(readFileSync(resolve(__dirname, '../datasets/production.json'), 'utf-8'));
  const draft1s = production.filter((r: any) => r.draftNumber === 1);
  // Pick 5 diverse essays
  const indices = [0, Math.floor(draft1s.length * 0.25), Math.floor(draft1s.length * 0.5), Math.floor(draft1s.length * 0.75), draft1s.length - 1];
  const sample = indices.map(i => draft1s[i]);

  console.log(`Testing ${PROMPT_VARIANTS.length} prompt variants on ${sample.length} essays`);
  console.log(`Model: ${FLASH} | Judge: ${JUDGE}\n`);

  const allResults: Array<{variant: string, proWins: number, flashWins: number, ties: number, avgDrift: number}> = [];

  for (const variant of PROMPT_VARIANTS) {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`VARIANT: ${variant.name}`);
    console.log(`${'═'.repeat(60)}\n`);

    const megaSystem = buildMegaSystem(variant.extra);
    let proWins = 0, flashWins = 0, ties = 0, totalDrift = 0;

    for (let i = 0; i < sample.length; i++) {
      const record = sample[i];
      const megaPrompt = `Perform a complete analysis of the following ${record.writingType} essay.\n\n## Assignment Prompt\n${record.assignmentPrompt}\n\n## Student Essay\n${record.content}\n\nAnalyze comprehensively. Score each trait independently.`;

      // Pro uses baseline system prompt, Flash uses the variant
      const proSystem = buildMegaSystem('');

      const [proResp, flashResp] = await Promise.all([
        ai.models.generateContent({ model: PRO, contents: megaPrompt, config: { systemInstruction: proSystem, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
        ai.models.generateContent({ model: FLASH, contents: megaPrompt, config: { systemInstruction: megaSystem, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA } }),
      ]);

      const proEval = JSON.parse(proResp.text || '{}').evaluation || {};
      const flashEval = JSON.parse(flashResp.text || '{}').evaluation || {};

      let drift = 0;
      for (const t of TRAITS) drift += Math.abs((proEval.traits?.[t]?.score || 0) - (flashEval.traits?.[t]?.score || 0));
      totalDrift += drift / 7;

      // Judge
      const proFb = TRAITS.map(t => { const tr = proEval.traits?.[t]; return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any)=> '"'+(a.quotedText||'').substring(0,50)+'" — '+(a.comment||'').substring(0,80)).join('\n')||'none'}` : ''; }).join('\n\n');
      const flashFb = TRAITS.map(t => { const tr = flashEval.traits?.[t]; return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any)=> '"'+(a.quotedText||'').substring(0,50)+'" — '+(a.comment||'').substring(0,80)).join('\n')||'none'}` : ''; }).join('\n\n');

      try {
        const judgeResp = await ai.models.generateContent({
          model: JUDGE,
          contents: `Compare two essay feedback sets. Which is more helpful for a student? Consider specificity, actionability, guiding questions.\n\nESSAY (excerpt): ${record.content.substring(0,400)}...\n\n--- FEEDBACK A (baseline) ---\n${proFb}\n\n--- FEEDBACK B (experimental) ---\n${flashFb}\n\nReturn JSON: {"winner": "A" or "B" or "tie", "rationale": "one sentence"}`,
          config: { responseMimeType: 'application/json' },
        });
        const parsed = JSON.parse(judgeResp.text || '{}');
        const winner = parsed.winner === 'A' ? 'pro' : parsed.winner === 'B' ? 'flash' : 'tie';
        if (winner === 'pro') proWins++;
        else if (winner === 'flash') flashWins++;
        else ties++;
        console.log(`  [${i+1}] ${winner}: ${(parsed.rationale || '').substring(0, 70)}`);
      } catch (e) {
        console.log(`  [${i+1}] error: ${e}`);
      }

      await sleep(3000);
    }

    const flashRate = (flashWins + ties) / sample.length;
    console.log(`\n  Result: Pro ${proWins}, Flash ${flashWins}, Tie ${ties} | Flash win/tie: ${(flashRate*100).toFixed(0)}% | Avg drift: ${(totalDrift/sample.length).toFixed(2)}`);
    allResults.push({ variant: variant.name, proWins, flashWins, ties, avgDrift: totalDrift / sample.length });
  }

  // Final comparison
  console.log(`\n${'═'.repeat(60)}`);
  console.log('VARIANT COMPARISON');
  console.log(`${'═'.repeat(60)}\n`);
  console.log('Variant'.padEnd(25), 'Pro'.padEnd(5), 'Flash'.padEnd(7), 'Tie'.padEnd(5), 'Flash%'.padEnd(8), 'Drift');
  for (const r of allResults) {
    const flashPct = ((r.flashWins + r.ties) / sample.length * 100).toFixed(0) + '%';
    console.log(r.variant.padEnd(25), String(r.proWins).padEnd(5), String(r.flashWins).padEnd(7), String(r.ties).padEnd(5), flashPct.padEnd(8), r.avgDrift.toFixed(2));
  }
}

main().catch(err => { console.error(err); process.exit(1); });
