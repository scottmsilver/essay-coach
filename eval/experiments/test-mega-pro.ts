import { GoogleGenAI } from '@google/genai';
import { readFileSync } from 'fs';
import { MEGA_SYSTEM_PROMPT, MEGA_SCHEMA } from '../../functions/lib/functions/src/megaPrompt.js';
import { buildEvaluationPrompt } from '../../functions/lib/functions/src/prompt.js';

const meta = JSON.parse(readFileSync('/tmp/test-meta.json', 'utf-8'));
const content = readFileSync('/tmp/test-essay.txt', 'utf-8');

async function run(model: string) {
  const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });
  let prompt = buildEvaluationPrompt({ assignmentPrompt: meta.assignmentPrompt, writingType: meta.writingType, content });
  prompt += '\n\nPerform a complete analysis: score all 6+1 traits, analyze grammar, transitions, prompt adherence, duplication, and coach synthesis. Return a single JSON object with all sections.';
  prompt += '\n\nFor coachSynthesis: this is draft 1. Readiness must be "keep_going" and improvements must be null.';

  const resp = await ai.models.generateContent({
    model,
    contents: prompt,
    config: { systemInstruction: MEGA_SYSTEM_PROMPT, responseMimeType: 'application/json', responseSchema: MEGA_SCHEMA },
  });
  return JSON.parse(resp.text || '{}');
}

async function main() {
  console.log('Running Pro mega and Flash Lite mega in parallel...\n');
  const [pro, flash] = await Promise.all([
    run('gemini-3.1-pro-preview'),
    run('gemini-3.1-flash-lite-preview'),
  ]);

  const traits = ['ideas','organization','voice','wordChoice','sentenceFluency','conventions','presentation'];

  console.log('=== EVALUATION ===');
  console.log('Trait'.padEnd(20), 'Pro'.padEnd(6), 'Flash'.padEnd(6));
  for (const t of traits) {
    console.log(t.padEnd(20), String(pro.evaluation?.traits?.[t]?.score||'?').padEnd(6), String(flash.evaluation?.traits?.[t]?.score||'?'));
  }

  console.log('\n=== TRANSITIONS ===');
  console.log('Pro  sentence:', pro.transitionAnalysis?.sentenceTransitions?.length, ', paragraph:', pro.transitionAnalysis?.paragraphTransitions?.length);
  console.log('Flash sentence:', flash.transitionAnalysis?.sentenceTransitions?.length, ', paragraph:', flash.transitionAnalysis?.paragraphTransitions?.length);

  console.log('\n=== GRAMMAR ===');
  const proGram = pro.grammarAnalysis;
  const flashGram = flash.grammarAnalysis;
  const countIssues = (g: any) => {
    let n = 0;
    for (const k of ['commaSplices','runOnSentences','fragments','subjectVerbAgreement','pronounReference','verbTenseConsistency','parallelStructure','punctuationErrors','missingCommas']) {
      n += g?.[k]?.locations?.length || 0;
    }
    return n;
  };
  console.log('Pro  totalErrors:', proGram?.summary?.totalErrors, ', issue locations:', countIssues(proGram));
  console.log('Flash totalErrors:', flashGram?.summary?.totalErrors, ', issue locations:', countIssues(flashGram));

  console.log('\n=== PROMPT ANALYSIS ===');
  console.log('Pro  questions:', pro.promptAnalysis?.questions?.length, ', cells:', pro.promptAnalysis?.summary?.totalCells);
  console.log('Flash questions:', flash.promptAnalysis?.questions?.length, ', cells:', flash.promptAnalysis?.summary?.totalCells);

  console.log('\n=== DUPLICATION ===');
  console.log('Pro  findings:', pro.duplicationAnalysis?.findings?.length);
  console.log('Flash findings:', flash.duplicationAnalysis?.findings?.length);

  console.log('\n=== COACH ===');
  console.log('Pro  readiness:', pro.coachSynthesis?.readiness, ', reports:', pro.coachSynthesis?.reportSummaries?.length);
  console.log('Flash readiness:', flash.coachSynthesis?.readiness, ', reports:', flash.coachSynthesis?.reportSummaries?.length);
}
main().catch(e => { console.error(e); process.exit(1); });
