import { readFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface TestCase {
  description: string;
  vars: Record<string, unknown>;
  assert?: Array<Record<string, unknown>>;
}

function loadTests(): TestCase[] {
  const tests: TestCase[] = [];

  // Track A: Production replay
  const prodPath = resolve(__dirname, 'datasets/production.json');
  if (existsSync(prodPath)) {
    const production = JSON.parse(readFileSync(prodPath, 'utf-8'));
    for (const record of production) {
      tests.push({
        description: `[Production] ${record.path} (draft ${record.draftNumber})`,
        vars: {
          content: record.content,
          assignmentPrompt: record.assignmentPrompt,
          writingType: record.writingType,
          draftNumber: record.draftNumber,
          previousEvaluation: record.previousEvaluation,
          baselineEvaluation: record.evaluation,
          dataset: 'production',
        },
        assert: [
          {
            type: 'javascript',
            value: `
              const evaluation = JSON.parse(output);
              const baseline = context.vars.baselineEvaluation;
              if (!baseline?.traits) return { pass: true, score: 1, reason: 'No baseline' };
              const traits = Object.keys(baseline.traits);
              const drifts = traits.map(t => {
                const bScore = baseline.traits[t]?.score || 0;
                const nScore = evaluation.traits?.[t]?.score || 0;
                return { trait: t, baseline: bScore, new: nScore, delta: nScore - bScore };
              });
              const avgDrift = drifts.reduce((sum, d) => sum + Math.abs(d.delta), 0) / drifts.length;
              return {
                pass: true,
                score: Math.max(0, 1 - avgDrift / 3),
                reason: 'Score drift: ' + drifts.map(d => d.trait + ': ' + (d.delta >= 0 ? '+' : '') + d.delta).join(', ') + ' (avg |delta|: ' + avgDrift.toFixed(1) + ')',
              };
            `,
          },
        ],
      });
    }
  } else {
    console.warn('Warning: production.json not found. Run: npx tsx export-firestore.ts');
  }

  // Track C: Calibration test suite
  const calPath = resolve(__dirname, 'datasets/calibration.json');
  if (existsSync(calPath)) {
    const calibration = JSON.parse(readFileSync(calPath, 'utf-8'));
    for (const essay of calibration) {
      const testCase: TestCase = {
        description: `[Calibration] ${essay.filename}${essay.scoreSource ? ' (' + essay.scoreSource + ')' : ''}`,
        vars: {
          content: essay.content,
          assignmentPrompt: essay.assignmentPrompt,
          writingType: essay.writingType,
          draftNumber: 1,
          previousEvaluation: null,
          expectedAvgScoreRange: essay.expectedAvgScoreRange,
          dataset: 'calibration',
        },
      };

      if (essay.expectedAvgScoreRange) {
        testCase.assert = [
          {
            type: 'javascript',
            value: `
              const evaluation = JSON.parse(output);
              const traits = ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'];
              const scores = traits.map(t => evaluation.traits?.[t]?.score || 0);
              const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
              const [min, max] = context.vars.expectedAvgScoreRange;
              const inRange = avg >= min && avg <= max;
              return {
                pass: true,
                score: inRange ? 1 : 0.5,
                reason: 'Avg score ' + avg.toFixed(1) + (inRange ? ' within' : ' OUTSIDE') + ' expected range [' + min + ', ' + max + ']',
              };
            `,
          },
        ];
      }

      tests.push(testCase);
    }
  } else {
    console.warn('Warning: calibration.json not found. Run: npx tsx build-calibration.ts');
  }

  console.log(`Loaded ${tests.length} test cases (production: ${tests.filter(t => (t.vars.dataset as string) === 'production').length}, calibration: ${tests.filter(t => (t.vars.dataset as string) === 'calibration').length})`);
  return tests;
}

export default loadTests();
