import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Haiku for screening, Sonnet for final verdicts on close calls
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'claude-haiku-4-5-20251001';
const TRAITS = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
const RELIABILITY_SAMPLE_RATE = 0.1;

interface TraitJudgment {
  trait: string;
  specificity: { score: number; rationale: string };
  actionability: { score: number; rationale: string };
  socratic_tone: { score: number; rationale: string };
}

interface PairwiseJudgment {
  winner: 'incumbent' | 'challenger' | 'tie';
  rationale: string;
}

interface JudgeResult {
  description: string;
  incumbentTraitScores: TraitJudgment[];
  challengerTraitScores: TraitJudgment[];
  pairwise: PairwiseJudgment;
  reliabilityCheck?: {
    firstRun: TraitJudgment[];
    secondRun: TraitJudgment[];
    agreementRate: number;
  };
}

function buildTraitJudgePrompt(essayContent: string, traitName: string, feedback: string, annotationsJson: string): string {
  return `You are evaluating the quality of essay feedback produced by an AI writing coach.
You will see the student's essay, a specific writing trait being evaluated, and the
AI coach's feedback and annotations for that trait.

Rate the feedback on these three dimensions, each scored 1-5:

## Specificity (applies to the feedback text)
Does the feedback reference concrete details from this specific essay?
- 1: Completely generic, could apply to any essay
- 3: References the essay's topic but not specific passages or details
- 5: Points to exact passages, quotes, or structural elements

## Actionability (applies to the feedback text and revision suggestions)
Can the student act on this feedback without being told what to write?
- 1: Vague encouragement or criticism with no direction
- 3: Identifies what to improve but not how
- 5: Gives a clear, specific next step the student can take

## Socratic Tone (applies ONLY to the annotations array)
Do the annotations guide through questions rather than dictate or rewrite?
- 1: Rewrites the student's text or provides replacement sentences
- 3: Identifies problems but tells rather than asks
- 5: Asks questions that lead the student to discover the issue

Note: The coaching system uses different tones for different score levels. Do NOT penalize appropriate tone variation.

---

ESSAY:
${essayContent}

TRAIT: ${traitName}

FEEDBACK: ${feedback}

ANNOTATIONS:
${annotationsJson}

---

Respond with ONLY a JSON object, no other text:
{"specificity": {"score": N, "rationale": "..."}, "actionability": {"score": N, "rationale": "..."}, "socratic_tone": {"score": N, "rationale": "..."}}`;
}

function buildPairwisePrompt(essayContent: string, incumbentFeedback: string, challengerFeedback: string): string {
  return `You are comparing two sets of essay feedback produced by different AI writing coaches.
Both evaluated the same student essay. Which feedback is more helpful for a student revising this essay?

Consider: specificity, actionability, and whether annotations guide rather than dictate.

ESSAY:
${essayContent}

--- FEEDBACK A ---
${incumbentFeedback}

--- FEEDBACK B ---
${challengerFeedback}

---

Which is more helpful for a student revising this essay? Respond with ONLY a JSON object:
{"winner": "A" or "B" or "tie", "rationale": "one sentence explaining why"}`;
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function callJudge(anthropic: Anthropic, prompt: string, retries = 3): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await anthropic.messages.create({
        model: JUDGE_MODEL,
        max_tokens: 500,
        messages: [{ role: 'user', content: prompt }],
      });
      const text = response.content[0].type === 'text' ? response.content[0].text : '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON object found in response');
      return JSON.parse(jsonMatch[0]);
    } catch (err) {
      if (attempt < retries) {
        const backoff = 1000 * Math.pow(2, attempt); // 1s, 2s, 4s
        await sleep(backoff);
        continue;
      }
      throw err;
    }
  }
  throw new Error('unreachable');
}

async function main() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.error('ANTHROPIC_API_KEY env var is required');
    process.exit(1);
  }

  const outputPath = resolve(__dirname, 'promptfoo-output.json');
  if (!existsSync(outputPath)) {
    console.error('No promptfoo-output.json found. Run: npx promptfoo eval -o promptfoo-output.json');
    process.exit(1);
  }

  const evalResults = JSON.parse(readFileSync(outputPath, 'utf-8'));
  const anthropic = new Anthropic({ apiKey });

  const results: JudgeResult[] = [];
  const reliabilitySample: number[] = [];

  // Promptfoo output is flat: one result per (provider, essay) pair.
  // Group by testIdx to pair incumbent vs challenger for the same essay.
  const allResults = evalResults.results?.results || evalResults.results || [];
  const byTestIdx = new Map<number, Array<typeof allResults[0]>>();
  for (const r of allResults) {
    const idx = r.testIdx ?? r.testCase?.idx ?? 0;
    if (!byTestIdx.has(idx)) byTestIdx.set(idx, []);
    byTestIdx.get(idx)!.push(r);
  }

  const essayPairs = Array.from(byTestIdx.values()).filter(pair => pair.length === 2);
  const totalEssays = essayPairs.length;
  const sampleCount = Math.max(1, Math.ceil(totalEssays * RELIABILITY_SAMPLE_RATE));
  const sampleIndices = new Set<number>();
  while (sampleIndices.size < sampleCount && sampleIndices.size < totalEssays) {
    sampleIndices.add(Math.floor(Math.random() * totalEssays));
  }

  // Process essays in batches — 3 essays x 15 calls = 45 concurrent, ~5s pause between batches
  // Stays within 450K input tokens/min and 1K RPM limits
  const CONCURRENCY = 3;

  console.log(`Judging ${totalEssays} essay comparisons (${CONCURRENCY} essays in parallel)...`);
  console.log(`Reliability sample: ${sampleCount} essays will be judged twice\n`);

  async function judgeEssay(i: number): Promise<JudgeResult | null> {
    const pair = essayPairs[i];
    pair.sort((a, b) => {
      const aLabel = a.provider?.label || a.provider?.id || '';
      const aIsIncumbent = aLabel.includes('incumbent') || aLabel.includes('pro-preview');
      return aIsIncumbent ? -1 : 1;
    });

    const incResult = pair[0];
    const chalResult = pair[1];
    const description = incResult.testCase?.description || incResult.vars?.dataset || `Essay ${i + 1}`;

    const incOutputStr = incResult.response?.output || '{}';
    const chalOutputStr = chalResult.response?.output || '{}';
    const incumbentOutput = JSON.parse(typeof incOutputStr === 'string' ? incOutputStr : JSON.stringify(incOutputStr));
    const challengerOutput = JSON.parse(typeof chalOutputStr === 'string' ? chalOutputStr : JSON.stringify(chalOutputStr));
    const essayContent = incResult.vars?.content || '';

    if (!incumbentOutput.traits || !challengerOutput.traits) {
      console.warn(`  Skipping ${description}: missing traits in output`);
      return null;
    }

    try {
      // Fire all trait judgments + pairwise in parallel (15 calls at once)
      const traitPromises = TRAITS.flatMap(trait => {
        const incTrait = incumbentOutput.traits[trait];
        const chalTrait = challengerOutput.traits[trait];
        if (!incTrait || !chalTrait) return [];
        return [
          callJudge(anthropic, buildTraitJudgePrompt(
            essayContent, trait, incTrait.feedback, JSON.stringify(incTrait.annotations, null, 2)
          )).then(j => ({ side: 'inc' as const, trait, judgment: j })),
          callJudge(anthropic, buildTraitJudgePrompt(
            essayContent, trait, chalTrait.feedback, JSON.stringify(chalTrait.annotations, null, 2)
          )).then(j => ({ side: 'chal' as const, trait, judgment: j })),
        ];
      });

      const incSummary = TRAITS.map(t => {
        const trait = incumbentOutput.traits[t];
        return trait ? `${t}: ${trait.feedback}\nAnnotations: ${JSON.stringify(trait.annotations)}` : '';
      }).join('\n\n');
      const chalSummary = TRAITS.map(t => {
        const trait = challengerOutput.traits[t];
        return trait ? `${t}: ${trait.feedback}\nAnnotations: ${JSON.stringify(trait.annotations)}` : '';
      }).join('\n\n');

      const pairPromise = callJudge(anthropic, buildPairwisePrompt(essayContent, incSummary, chalSummary));

      const [traitResults, pairResult] = await Promise.all([
        Promise.all(traitPromises),
        pairPromise,
      ]);

      const incumbentScores: TraitJudgment[] = traitResults
        .filter(r => r.side === 'inc')
        .map(r => ({ trait: r.trait, ...r.judgment }) as TraitJudgment);
      const challengerScores: TraitJudgment[] = traitResults
        .filter(r => r.side === 'chal')
        .map(r => ({ trait: r.trait, ...r.judgment }) as TraitJudgment);

      const pairwise: PairwiseJudgment = {
        winner: pairResult.winner === 'A' ? 'incumbent' : pairResult.winner === 'B' ? 'challenger' : 'tie',
        rationale: pairResult.rationale as string,
      };

      const judgeResult: JudgeResult = {
        description,
        incumbentTraitScores: incumbentScores,
        challengerTraitScores: challengerScores,
        pairwise,
      };

      // Reliability check
      if (sampleIndices.has(i) && incumbentScores.length > 0) {
        const checkTrait = incumbentScores[0].trait;
        const incTrait = incumbentOutput.traits[checkTrait];
        const rerunJudgment = await callJudge(anthropic, buildTraitJudgePrompt(
          essayContent, checkTrait, incTrait.feedback, JSON.stringify(incTrait.annotations, null, 2)
        ));

        const firstRun = incumbentScores[0];
        const agree = (
          firstRun.specificity.score === (rerunJudgment as any).specificity.score &&
          firstRun.actionability.score === (rerunJudgment as any).actionability.score &&
          firstRun.socratic_tone.score === (rerunJudgment as any).socratic_tone.score
        );
        reliabilitySample.push(agree ? 1 : 0);

        judgeResult.reliabilityCheck = {
          firstRun: [firstRun],
          secondRun: [{ trait: checkTrait, ...rerunJudgment } as TraitJudgment],
          agreementRate: agree ? 1 : 0,
        };
      }

      return judgeResult;
    } catch (err) {
      console.warn(`    ⚠ Judge error on essay ${i + 1}: ${err instanceof Error ? err.message : err}`);
      return null;
    }
  }

  // Process in batches of CONCURRENCY
  for (let batch = 0; batch < essayPairs.length; batch += CONCURRENCY) {
    const batchEnd = Math.min(batch + CONCURRENCY, essayPairs.length);
    const batchIndices = Array.from({ length: batchEnd - batch }, (_, j) => batch + j);
    console.log(`  Batch ${Math.floor(batch / CONCURRENCY) + 1}: essays ${batch + 1}-${batchEnd}`);

    const batchResults = await Promise.all(batchIndices.map(i => judgeEssay(i)));
    for (const r of batchResults) {
      if (r) results.push(r);
    }
    // Pause between batches to stay within token-per-minute limits
    if (batchEnd < essayPairs.length) await sleep(5000);
  }

  // Summary
  const incAvg = { specificity: 0, actionability: 0, socratic_tone: 0, count: 0 };
  const chalAvg = { specificity: 0, actionability: 0, socratic_tone: 0, count: 0 };

  for (const r of results) {
    for (const t of r.incumbentTraitScores) {
      incAvg.specificity += t.specificity.score;
      incAvg.actionability += t.actionability.score;
      incAvg.socratic_tone += t.socratic_tone.score;
      incAvg.count++;
    }
    for (const t of r.challengerTraitScores) {
      chalAvg.specificity += t.specificity.score;
      chalAvg.actionability += t.actionability.score;
      chalAvg.socratic_tone += t.socratic_tone.score;
      chalAvg.count++;
    }
  }

  const div = (n: number, d: number) => d > 0 ? (n / d).toFixed(2) : 'N/A';

  console.log('\n═══════════════════════════════════════════════════════════');
  console.log('              JUDGE RESULTS SUMMARY');
  console.log('═══════════════════════════════════════════════════════════\n');

  console.log('Average scores (1-5):');
  console.log(`  Incumbent  — Specificity: ${div(incAvg.specificity, incAvg.count)}, Actionability: ${div(incAvg.actionability, incAvg.count)}, Socratic: ${div(incAvg.socratic_tone, incAvg.count)}`);
  console.log(`  Challenger — Specificity: ${div(chalAvg.specificity, chalAvg.count)}, Actionability: ${div(chalAvg.actionability, chalAvg.count)}, Socratic: ${div(chalAvg.socratic_tone, chalAvg.count)}`);

  const incSpecAvg = parseFloat(div(incAvg.specificity, incAvg.count));
  const chalSpecAvg = parseFloat(div(chalAvg.specificity, chalAvg.count));
  const incActAvg = parseFloat(div(incAvg.actionability, incAvg.count));
  const chalActAvg = parseFloat(div(chalAvg.actionability, chalAvg.count));
  const incSocAvg = parseFloat(div(incAvg.socratic_tone, incAvg.count));
  const chalSocAvg = parseFloat(div(chalAvg.socratic_tone, chalAvg.count));

  const deltas = {
    specificity: Math.abs(incSpecAvg - chalSpecAvg),
    actionability: Math.abs(incActAvg - chalActAvg),
    socratic: Math.abs(incSocAvg - chalSocAvg),
  };
  const feedbackDelta = (deltas.specificity + deltas.actionability) / 2;

  console.log(`\n  Deltas — Specificity: ${deltas.specificity.toFixed(2)}, Actionability: ${deltas.actionability.toFixed(2)}, Socratic: ${deltas.socratic.toFixed(2)}`);
  console.log(`  Feedback quality delta (spec+act avg): ${feedbackDelta.toFixed(2)} ${feedbackDelta <= 0.5 ? 'PASS' : 'FAIL'} (threshold: <= 0.5)`);
  console.log(`  Socratic delta: ${deltas.socratic.toFixed(2)} ${deltas.socratic <= 0.5 ? 'PASS' : 'FAIL'} (threshold: <= 0.5)`);

  const pairwiseCounts = { incumbent: 0, challenger: 0, tie: 0 };
  for (const r of results) {
    pairwiseCounts[r.pairwise.winner]++;
  }
  const challengerWinRate = results.length > 0
    ? (pairwiseCounts.challenger + pairwiseCounts.tie) / results.length
    : 0;
  console.log(`\nPairwise: Incumbent ${pairwiseCounts.incumbent}, Challenger ${pairwiseCounts.challenger}, Tie ${pairwiseCounts.tie}`);
  console.log(`  Challenger wins/ties: ${(challengerWinRate * 100).toFixed(0)}% ${challengerWinRate >= 0.4 ? 'PASS' : 'FAIL'} (threshold: >= 40%)`);

  if (reliabilitySample.length > 0) {
    const agreement = reliabilitySample.reduce((a, b) => a + b, 0) / reliabilitySample.length;
    console.log(`\nJudge reliability: ${(agreement * 100).toFixed(0)}% agreement on ${reliabilitySample.length} re-runs ${agreement >= 0.8 ? 'OK' : 'WARNING: below 80%'}`);
  }

  const reportPath = resolve(__dirname, 'judge-results.json');
  writeFileSync(reportPath, JSON.stringify(results, null, 2));
  console.log(`\nFull results saved to ${reportPath}`);
}

main().catch((err) => {
  console.error('Judge failed:', err.message || err);
  process.exit(1);
});
