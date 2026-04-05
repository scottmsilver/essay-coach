/**
 * Full-output validator: acceptance gate for any configuration change.
 *
 * Validates ALL 6 analyses against production baselines.
 * Key checks that would catch the mega-prompt regression:
 * - Transition coverage: ~1 sentence transition per 25 words (production avg: 105%)
 * - Grammar completeness: all 9 error categories + higher-order patterns present
 * - Prompt analysis: matrix with rows, questions array
 * - Coach synthesis: valid readiness, >= 3 report summaries
 *
 * Usage:
 *   npx tsx validate-full-output.ts                    # validate production baselines
 *   npx tsx validate-full-output.ts --check <file>     # validate a candidate output file
 */

import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';

const __dirname = dirname(new URL(import.meta.url).pathname);

interface Check {
  name: string;
  pass: boolean;
  expected: string;
  actual: string;
  severity: 'critical' | 'warning';
}

/**
 * Validate a full 6-analysis output. Only checks analyses that are present (non-null).
 * Returns an array of checks with pass/fail for each.
 */
export function validateFullOutput(analysis: Record<string, any>, wordCount: number): Check[] {
  const checks: Check[] = [];

  // ── Evaluation ──
  const eval_ = analysis.evaluation;
  if (eval_) {
    const traits = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
    for (const t of traits) {
      const score = eval_.traits?.[t]?.score;
      if (score === undefined) {
        checks.push({ name: `eval.${t}`, pass: false, expected: 'present', actual: 'missing', severity: 'critical' });
      } else if (!Number.isInteger(score) || score < 1 || score > 6) {
        checks.push({ name: `eval.${t}.score`, pass: false, expected: '1-6', actual: String(score), severity: 'critical' });
      }
    }
  }

  // ── Transition coverage (THE key check that catches mega-prompt regression) ──
  const trans = analysis.transitionAnalysis;
  if (trans) {
    const sentTrans = trans.sentenceTransitions?.length || 0;
    const expectedSent = Math.max(2, Math.floor(wordCount / 25));
    const minSent = Math.floor(expectedSent * 0.5);

    checks.push({
      name: 'trans.sentCoverage',
      pass: sentTrans >= minSent,
      expected: `>= ${minSent} (50% of ~${expectedSent} for ${wordCount} words)`,
      actual: `${sentTrans} (${(sentTrans / expectedSent * 100).toFixed(0)}% coverage)`,
      severity: 'critical',
    });

    checks.push({
      name: 'trans.hasSummary',
      pass: typeof trans.summary === 'string' && trans.summary.length > 10,
      expected: 'summary > 10 chars',
      actual: trans.summary ? `${trans.summary.length} chars` : 'missing',
      severity: 'warning',
    });
  }

  // ── Grammar completeness ──
  const gram = analysis.grammarAnalysis;
  if (gram) {
    const cats = ['commaSplices', 'runOnSentences', 'fragments', 'subjectVerbAgreement',
      'pronounReference', 'verbTenseConsistency', 'parallelStructure', 'punctuationErrors', 'missingCommas'];
    const missing = cats.filter(c => gram[c] === undefined);

    checks.push({
      name: 'gram.categories',
      pass: missing.length === 0,
      expected: 'all 9 categories',
      actual: missing.length === 0 ? 'all present' : `missing: ${missing.join(', ')}`,
      severity: 'critical',
    });

    checks.push({
      name: 'gram.sentenceVariety',
      pass: !!gram.sentenceVariety,
      expected: 'present',
      actual: gram.sentenceVariety ? 'present' : 'missing',
      severity: 'warning',
    });

    checks.push({
      name: 'gram.activePassiveVoice',
      pass: !!gram.activePassiveVoice,
      expected: 'present',
      actual: gram.activePassiveVoice ? 'present' : 'missing',
      severity: 'warning',
    });

    checks.push({
      name: 'gram.summary',
      pass: !!gram.summary?.overallComment,
      expected: 'summary with comment',
      actual: gram.summary?.overallComment ? 'present' : 'missing',
      severity: 'critical',
    });
  }

  // ── Prompt analysis ──
  const prompt = analysis.promptAnalysis;
  if (prompt) {
    checks.push({
      name: 'prompt.matrix',
      pass: (prompt.matrix?.rows?.length || 0) > 0,
      expected: 'matrix with rows',
      actual: `${prompt.matrix?.rows?.length || 0} rows`,
      severity: 'critical',
    });

    checks.push({
      name: 'prompt.questions',
      pass: Array.isArray(prompt.questions) && prompt.questions.length > 0,
      expected: '>= 1 question',
      actual: `${prompt.questions?.length || 0} questions`,
      severity: 'warning',
    });
  }

  // ── Duplication ──
  const dup = analysis.duplicationAnalysis;
  if (dup) {
    checks.push({
      name: 'dup.findings',
      pass: Array.isArray(dup.findings),
      expected: 'findings array',
      actual: Array.isArray(dup.findings) ? `${dup.findings.length} findings` : 'missing',
      severity: 'critical',
    });

    checks.push({
      name: 'dup.summary',
      pass: !!dup.summary?.overallComment,
      expected: 'summary with comment',
      actual: dup.summary?.overallComment ? 'present' : 'missing',
      severity: 'warning',
    });
  }

  // ── Coach synthesis ──
  const coach = analysis.coachSynthesis;
  if (coach) {
    checks.push({
      name: 'coach.readiness',
      pass: ['keep_going', 'getting_close', 'almost_there', 'ready'].includes(coach.readiness),
      expected: 'valid readiness',
      actual: coach.readiness || 'missing',
      severity: 'critical',
    });

    checks.push({
      name: 'coach.reports',
      pass: Array.isArray(coach.reportSummaries) && coach.reportSummaries.length >= 3,
      expected: '>= 3 reports',
      actual: `${coach.reportSummaries?.length || 0}`,
      severity: 'critical',
    });

    checks.push({
      name: 'coach.note',
      pass: typeof coach.coachNote === 'string' && coach.coachNote.length > 20,
      expected: 'note > 20 chars',
      actual: coach.coachNote ? `${coach.coachNote.length} chars` : 'missing',
      severity: 'warning',
    });
  }

  return checks;
}

// ── CLI: validate production baselines ──

async function main() {
  const args = process.argv.slice(2);

  const prodPath = resolve(__dirname, 'datasets/production.json');
  const production = JSON.parse(readFileSync(prodPath, 'utf-8'));

  // Only check drafts that have at least transitions (the most common analysis)
  const draft1s = production.filter((r: any) => r.draftNumber === 1 && r.transitionAnalysis);

  console.log(`Validating ${draft1s.length} production drafts with transition data\n`);

  let totalChecks = 0;
  let passedChecks = 0;
  let criticalFails = 0;
  let failedEssays: string[] = [];

  for (const record of draft1s) {
    const wc = record.content.split(/\s+/).length;
    const checks = validateFullOutput({
      evaluation: record.evaluation,
      grammarAnalysis: record.grammarAnalysis,
      transitionAnalysis: record.transitionAnalysis,
      promptAnalysis: record.promptAnalysis,
      duplicationAnalysis: record.duplicationAnalysis,
      coachSynthesis: record.coachSynthesis,
    }, wc);

    const failed = checks.filter(c => !c.pass);
    const critFailed = failed.filter(c => c.severity === 'critical');
    totalChecks += checks.length;
    passedChecks += checks.length - failed.length;
    criticalFails += critFailed.length;

    if (critFailed.length > 0) {
      failedEssays.push(record.path.split('/').pop());
      if (failedEssays.length <= 5) {
        console.log(`${record.path.split('/').pop()} (${wc}w):`);
        for (const f of critFailed) {
          console.log(`  ✗ [${f.severity}] ${f.name}: expected ${f.expected}, got ${f.actual}`);
        }
      }
    }
  }

  console.log(`\n${'═'.repeat(50)}`);
  console.log('PRODUCTION BASELINE VALIDATION');
  console.log(`${'═'.repeat(50)}\n`);
  console.log(`Drafts: ${draft1s.length}`);
  console.log(`Checks: ${totalChecks}, Passed: ${passedChecks} (${(passedChecks / totalChecks * 100).toFixed(0)}%)`);
  console.log(`Critical failures: ${criticalFails}`);
  console.log(`Failed essays: ${failedEssays.length}/${draft1s.length}`);

  if (criticalFails === 0) {
    console.log('\n✓ All production baselines pass. This is the bar any new configuration must clear.');
  } else {
    console.log(`\n✗ ${criticalFails} critical failures in production baselines — investigate before using as acceptance gate.`);
  }

  process.exit(criticalFails > 0 ? 1 : 0);
}

// Only run CLI when invoked directly, not when imported
const isMain = process.argv[1]?.endsWith('validate-full-output.ts') || process.argv[1]?.endsWith('validate-full-output.js');
if (isMain) {
  main().catch((err) => {
    console.error('Validation failed:', err.message || err);
    process.exit(1);
  });
}
