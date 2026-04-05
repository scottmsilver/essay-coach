/**
 * Re-judge the existing Pro vs Flash Lite results using Gemini 3 Pro as judge.
 * Reads promptfoo-output.json (already has both models' outputs for 110 essays).
 */

import { GoogleGenAI } from '@google/genai';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(new URL(import.meta.url).pathname);
const JUDGE_MODEL = 'gemini-3-pro-preview';
const TRAITS = ['ideas','organization','voice','wordChoice','sentenceFluency','conventions','presentation'];

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callGeminiJudge(ai: any, prompt: string, retries = 3): Promise<Record<string, any>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const resp = await ai.models.generateContent({
        model: JUDGE_MODEL,
        contents: prompt,
        config: { responseMimeType: 'application/json' },
      });
      const text = resp.text || '';
      const match = text.match(/\{[\s\S]*\}/);
      if (!match) throw new Error('No JSON in response');
      return JSON.parse(match[0]);
    } catch (err) {
      if (attempt < retries) { await sleep(1000 * Math.pow(2, attempt)); continue; }
      throw err;
    }
  }
  throw new Error('unreachable');
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY!;
  const ai = new GoogleGenAI({ apiKey });

  const evalResults = JSON.parse(readFileSync(resolve(__dirname, '../promptfoo-output.json'), 'utf-8'));
  const allResults = evalResults.results?.results || [];

  // Group by testIdx to pair incumbent vs challenger
  const byTestIdx = new Map<number, any[]>();
  for (const r of allResults) {
    const idx = r.testIdx ?? 0;
    if (!byTestIdx.has(idx)) byTestIdx.set(idx, []);
    byTestIdx.get(idx)!.push(r);
  }
  const essayPairs = Array.from(byTestIdx.values()).filter(p => p.length === 2);

  console.log(`Gemini 3 Pro judging ${essayPairs.length} essay comparisons (3 at a time)...\n`);

  const results: any[] = [];
  const CONCURRENCY = 3;

  async function judgeEssay(i: number) {
    const pair = essayPairs[i];
    pair.sort((a: any, b: any) => {
      const aLabel = a.provider?.label || '';
      return aLabel.includes('incumbent') ? -1 : 1;
    });

    const incOutput = JSON.parse(pair[0].response?.output || '{}');
    const chalOutput = JSON.parse(pair[1].response?.output || '{}');
    const essayContent = (pair[0].vars?.content || '').substring(0, 800);

    if (!incOutput.traits || !chalOutput.traits) return null;

    try {
      // One consolidated judge call per essay (not per-trait)
      const incFeedback = TRAITS.map(t => {
        const tr = incOutput.traits[t];
        return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any) => '"' + a.quotedText?.substring(0,60) + '" — ' + a.comment?.substring(0,80)).join('\n') || 'none'}` : '';
      }).join('\n\n');

      const chalFeedback = TRAITS.map(t => {
        const tr = chalOutput.traits[t];
        return tr ? `${t} (${tr.score}/6): ${tr.feedback}\nAnnotations: ${tr.annotations?.map((a:any) => '"' + a.quotedText?.substring(0,60) + '" — ' + a.comment?.substring(0,80)).join('\n') || 'none'}` : '';
      }).join('\n\n');

      const result = await callGeminiJudge(ai, `Compare two essay feedback sets. Which is more helpful for a high school student improving their writing? Consider specificity, actionability, and whether annotations guide through questions.

ESSAY EXCERPT: ${essayContent}...

--- FEEDBACK A ---
${incFeedback}

--- FEEDBACK B ---
${chalFeedback}

Rate each on specificity (1-5), actionability (1-5), socratic_tone (1-5), then pick overall winner.
Return JSON: {"a_scores": {"specificity": N, "actionability": N, "socratic_tone": N}, "b_scores": {"specificity": N, "actionability": N, "socratic_tone": N}, "winner": "A" or "B" or "tie", "rationale": "one sentence"}`);

      return {
        winner: result.winner === 'A' ? 'incumbent' : result.winner === 'B' ? 'challenger' : 'tie',
        a_scores: result.a_scores,
        b_scores: result.b_scores,
        rationale: result.rationale,
      };
    } catch (err) {
      console.warn(`  ⚠ Essay ${i+1}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  for (let batch = 0; batch < essayPairs.length; batch += CONCURRENCY) {
    const batchEnd = Math.min(batch + CONCURRENCY, essayPairs.length);
    const indices = Array.from({ length: batchEnd - batch }, (_, j) => batch + j);
    console.log(`  Batch ${Math.floor(batch/CONCURRENCY)+1}: essays ${batch+1}-${batchEnd}`);
    const batchResults = await Promise.all(indices.map(i => judgeEssay(i)));
    for (const r of batchResults) { if (r) results.push(r); }
    if (batchEnd < essayPairs.length) await sleep(3000);
  }

  // Summary
  const counts = { incumbent: 0, challenger: 0, tie: 0 };
  const aAvg = { specificity: 0, actionability: 0, socratic_tone: 0 };
  const bAvg = { specificity: 0, actionability: 0, socratic_tone: 0 };

  for (const r of results) {
    counts[r.winner as keyof typeof counts]++;
    if (r.a_scores) { aAvg.specificity += r.a_scores.specificity; aAvg.actionability += r.a_scores.actionability; aAvg.socratic_tone += r.a_scores.socratic_tone; }
    if (r.b_scores) { bAvg.specificity += r.b_scores.specificity; bAvg.actionability += r.b_scores.actionability; bAvg.socratic_tone += r.b_scores.socratic_tone; }
  }

  const n = results.length;
  const d = (v: number) => (v/n).toFixed(2);

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('         GEMINI 3 PRO JUDGE: Pro vs Flash Lite');
  console.log('═══════════════════════════════════════════════════════════\n');
  console.log(`Judged: ${n} essays`);
  console.log(`\nAvg scores (1-5):`);
  console.log(`  Incumbent (Pro)    — Spec: ${d(aAvg.specificity)}, Act: ${d(aAvg.actionability)}, Socratic: ${d(aAvg.socratic_tone)}`);
  console.log(`  Challenger (Flash) — Spec: ${d(bAvg.specificity)}, Act: ${d(bAvg.actionability)}, Socratic: ${d(bAvg.socratic_tone)}`);
  console.log(`\nPairwise: Pro ${counts.incumbent}, Flash Lite ${counts.challenger}, Tie ${counts.tie}`);
  const chalRate = (counts.challenger + counts.tie) / n;
  console.log(`  Flash wins/ties: ${(chalRate*100).toFixed(0)}% ${chalRate >= 0.4 ? 'PASS' : 'FAIL'} (threshold: >= 40%)`);

  writeFileSync(resolve(__dirname, '../judge-results-gemini-pro.json'), JSON.stringify(results, null, 2));
  console.log('\nSaved to judge-results-gemini-pro.json');
}

main().catch(err => { console.error(err); process.exit(1); });
