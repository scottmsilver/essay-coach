/**
 * CLI test harness for criteria analysis.
 *
 * Usage:
 *   npx tsx scripts/test-criteria.ts [essay-file] [--type argumentative] [--prompt "..."] [--criteria "..."]
 *   npx tsx scripts/test-criteria.ts --sample          # use built-in sample essay + criteria
 *   npx tsx scripts/test-criteria.ts essay.txt --criteria-file criteria.txt
 *
 * Requires GEMINI_API_KEY env var.
 */

import { readFileSync, existsSync } from 'fs';
import { CRITERIA_SYSTEM_PROMPT, CRITERIA_ANALYSIS_SCHEMA, buildCriteriaPrompt } from '../src/criteria';
import { GoogleGenAI } from '@google/genai';

// ── Config ──────────────────────────────────────────────────────────────────

const SAMPLE_CRITERIA = `1. Clear thesis statement that takes a position on the topic
2. At least three distinct supporting arguments with evidence from the sources
3. Addresses and refutes a counterargument
4. Logical organization with clear transitions between paragraphs
5. Formal academic tone appropriate for the audience
6. Conclusion that reinforces the thesis without simply restating it`;

const SAMPLE_PROMPT = 'Some people believe that libraries should not add 3-D printers to their collections. Write a letter to your local newspaper in which you state your opinion on the issue.';

// ── Parse args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let essayContent = '';
  let writingType = 'argumentative';
  let assignmentPrompt = SAMPLE_PROMPT;
  let teacherCriteria = '';
  let useSample = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sample':
        useSample = true;
        break;
      case '--type':
        writingType = args[++i];
        break;
      case '--prompt':
        assignmentPrompt = args[++i];
        break;
      case '--criteria':
        teacherCriteria = args[++i];
        break;
      case '--criteria-file':
        teacherCriteria = readFileSync(args[++i], 'utf-8');
        break;
      default:
        if (existsSync(args[i])) {
          essayContent = readFileSync(args[i], 'utf-8');
        } else {
          console.error(`File not found: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  if (useSample || !essayContent) {
    useSample = true;
  }

  if (!teacherCriteria) {
    teacherCriteria = SAMPLE_CRITERIA;
  }

  return { essayContent, writingType, assignmentPrompt, teacherCriteria, useSample };
}

// ── Main ────────────────────────────────────────────────────────────────────

const STATUS_ICONS: Record<string, string> = {
  met: '✅',
  partially_met: '🟡',
  not_met: '❌',
};

const STATUS_LABELS: Record<string, string> = {
  met: 'Met',
  partially_met: 'Partial',
  not_met: 'Not Met',
};

async function runCriteriaAnalysis(
  apiKey: string,
  essayContent: string,
  writingType: string,
  assignmentPrompt: string,
  teacherCriteria: string,
  label: string,
) {
  const wordCount = essayContent.trim().split(/\s+/).length;
  console.log(`\n${'═'.repeat(65)}`);
  console.log(`  ${label}`);
  console.log(`${'═'.repeat(65)}`);
  console.log(`  Words: ${wordCount}  |  Type: ${writingType}`);
  console.log('  Evaluating with Gemini...\n');

  const prompt = buildCriteriaPrompt({
    teacherCriteria,
    assignmentPrompt,
    writingType,
    content: essayContent,
  });

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: CRITERIA_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: CRITERIA_ANALYSIS_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    console.error('  Gemini returned an empty response');
    return null;
  }

  const analysis = JSON.parse(text);

  // ── Pretty print ────────────────────────────────────────────────────────

  // Summary line
  const met = analysis.criteria.filter((c: { status: string }) => c.status === 'met').length;
  const partial = analysis.criteria.filter((c: { status: string }) => c.status === 'partially_met').length;
  const notMet = analysis.criteria.filter((c: { status: string }) => c.status === 'not_met').length;
  const total = analysis.criteria.length;
  console.log(`  Score: ${met}/${total} met, ${partial} partial, ${notMet} not met\n`);

  // Per-criterion results
  for (const criterion of analysis.criteria) {
    const icon = STATUS_ICONS[criterion.status] || '?';
    const label = STATUS_LABELS[criterion.status] || '?';
    console.log(`  ${icon} [${label.padEnd(7)}] ${criterion.criterion}`);
    console.log(`     Evidence: ${criterion.evidence.slice(0, 120)}${criterion.evidence.length > 120 ? '...' : ''}`);
    console.log(`     Comment:  ${criterion.comment.slice(0, 120)}${criterion.comment.length > 120 ? '...' : ''}`);
    if (criterion.annotations.length > 0) {
      console.log(`     Annotations: ${criterion.annotations.length}`);
      for (const ann of criterion.annotations.slice(0, 2)) {
        console.log(`       → "${ann.quotedText.slice(0, 80)}${ann.quotedText.length > 80 ? '...' : ''}"`);
        console.log(`         ${ann.comment.slice(0, 100)}${ann.comment.length > 100 ? '...' : ''}`);
      }
    }
    console.log('');
  }

  // Overall narrative
  console.log('  ─── Overall Narrative ───');
  console.log(`  ${analysis.overallNarrative}\n`);

  return analysis;
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY env var is required.');
    console.error('Usage: GEMINI_API_KEY=xxx npx tsx scripts/test-criteria.ts --sample');
    process.exit(1);
  }

  const { essayContent, writingType, assignmentPrompt, teacherCriteria, useSample } = parseArgs();

  console.log('═══════════════════════════════════════════════════════════════════');
  console.log('              TEACHER CRITERIA ANALYSIS TEST');
  console.log('═══════════════════════════════════════════════════════════════════');
  console.log(`\nTeacher Criteria:\n${teacherCriteria}\n`);
  console.log(`Assignment: ${assignmentPrompt.slice(0, 80)}...`);

  if (useSample) {
    // Run against two essays at different quality levels
    console.log('\n  Running against A-level and C-level essays to verify differentiation...');

    const essayA = readFileSync('test-essays/oregon-3dprinters-A-exceeds.txt', 'utf-8');
    const essayC = readFileSync('test-essays/oregon-3dprinters-C-approaching.txt', 'utf-8');

    const resultA = await runCriteriaAnalysis(apiKey, essayA, writingType, assignmentPrompt, teacherCriteria, 'A-LEVEL ESSAY (Exceeds)');
    const resultC = await runCriteriaAnalysis(apiKey, essayC, writingType, assignmentPrompt, teacherCriteria, 'C-LEVEL ESSAY (Approaching)');

    // Compare results
    if (resultA && resultC) {
      console.log('═══════════════════════════════════════════════════════════════════');
      console.log('              COMPARISON: A vs C');
      console.log('═══════════════════════════════════════════════════════════════════\n');

      const metA = resultA.criteria.filter((c: { status: string }) => c.status === 'met').length;
      const metC = resultC.criteria.filter((c: { status: string }) => c.status === 'met').length;
      console.log(`  A-level: ${metA}/${resultA.criteria.length} criteria met`);
      console.log(`  C-level: ${metC}/${resultC.criteria.length} criteria met`);
      console.log(`  Differentiation: ${metA > metC ? '✅ A scored higher (expected)' : metA === metC ? '⚠️  Same score (may need prompt tuning)' : '❌ C scored higher (unexpected)'}`);

      // Per-criterion comparison
      console.log('\n  Per-criterion:');
      for (let i = 0; i < Math.min(resultA.criteria.length, resultC.criteria.length); i++) {
        const a = resultA.criteria[i];
        const c = resultC.criteria[i];
        const iconA = STATUS_ICONS[a.status] || '?';
        const iconC = STATUS_ICONS[c.status] || '?';
        console.log(`    ${a.criterion.slice(0, 50).padEnd(52)} A: ${iconA}  C: ${iconC}`);
      }
    }
  } else {
    await runCriteriaAnalysis(apiKey, essayContent, writingType, assignmentPrompt, teacherCriteria, 'CRITERIA ANALYSIS');
  }

  console.log('\n  Done.');
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
