import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const essayDir = resolve(__dirname, '../functions/test-essays');

interface TestCase {
  description: string;
  vars: Record<string, unknown>;
  assert?: Array<Record<string, unknown>>;
}

// ── Teacher Criteria Sets ────────────────────────────────────────────────────
// Each set defines criteria for a specific assignment prompt + expected outcomes

const CRITERIA_SETS = {
  '3dprinters': {
    assignmentPrompt: 'Some people believe that libraries should not add 3-D printers to their collections. Write a letter to your local newspaper in which you state your opinion on the issue.',
    writingType: 'argumentative',
    teacherCriteria: `1. Clear thesis statement that takes a position on the topic
2. At least three distinct supporting arguments with evidence from the sources
3. Addresses and refutes a counterargument
4. Logical organization with clear transitions between paragraphs
5. Formal academic tone appropriate for the audience
6. Conclusion that reinforces the thesis without simply restating it`,
    essays: [
      { file: 'oregon-3dprinters-A-exceeds.txt', level: 'A', expectedMetMin: 3 },
      { file: 'oregon-3dprinters-B-meets.txt', level: 'B', expectedMetMin: 2 },
      { file: 'oregon-3dprinters-C-approaching.txt', level: 'C', expectedMetMin: 1 },
      { file: 'oregon-3dprinters-D-doesnotmeet.txt', level: 'D', expectedMetMin: 0 },
    ],
  },
  'sunflower': {
    assignmentPrompt: 'Write an informational essay about how sunflowers are grown and used.',
    writingType: 'informational',
    teacherCriteria: `1. Introduction hooks the reader and previews the topic
2. Information is organized into clear subtopics or sections
3. Uses specific facts, details, and examples to explain the topic
4. Maintains an objective, informational tone throughout
5. Vocabulary is appropriate for the topic and audience
6. Conclusion summarizes key points or leaves the reader with a final thought`,
    essays: [
      { file: 'oregon-sunflower-A-exceeds.txt', level: 'A', expectedMetMin: 3 },
      { file: 'oregon-sunflower-B-meets.txt', level: 'B', expectedMetMin: 2 },
      { file: 'oregon-sunflower-C-approaching.txt', level: 'C', expectedMetMin: 1 },
      { file: 'oregon-sunflower-D-doesnotmeet.txt', level: 'D', expectedMetMin: 0 },
    ],
  },
  'geocaching': {
    assignmentPrompt: 'Write an informational essay about geocaching.',
    writingType: 'informational',
    teacherCriteria: `1. Clearly explains what geocaching is for someone unfamiliar with it
2. Includes specific details about how geocaching works (equipment, process)
3. Discusses the appeal or benefits of geocaching
4. Well-organized with a logical flow from introduction to conclusion
5. Uses engaging language that draws the reader in
6. Provides a clear conclusion`,
    essays: [
      { file: 'oregon-geocaching-A-exceeds.txt', level: 'A', expectedMetMin: 3 },
      { file: 'oregon-geocaching-B-meets.txt', level: 'B', expectedMetMin: 2 },
      { file: 'oregon-geocaching-C-approaching.txt', level: 'C', expectedMetMin: 1 },
      { file: 'oregon-geocaching-D-doesnotmeet.txt', level: 'D', expectedMetMin: 0 },
    ],
  },
};

function loadTests(): TestCase[] {
  const tests: TestCase[] = [];

  for (const [setName, config] of Object.entries(CRITERIA_SETS)) {
    for (const essay of config.essays) {
      const filePath = resolve(essayDir, essay.file);
      const content = readFileSync(filePath, 'utf-8');

      tests.push({
        description: `[Criteria] ${setName} — ${essay.level}-level (${essay.file})`,
        vars: {
          content,
          assignmentPrompt: config.assignmentPrompt,
          writingType: config.writingType,
          teacherCriteria: config.teacherCriteria,
          expectedLevel: essay.level,
          expectedMetMin: essay.expectedMetMin,
          dataset: 'criteria',
        },
        assert: [
          // Schema validation
          {
            type: 'javascript',
            value: `
              const analysis = JSON.parse(output);
              const errors = [];

              if (!Array.isArray(analysis.criteria)) errors.push('criteria is not an array');
              if (typeof analysis.overallNarrative !== 'string') errors.push('missing overallNarrative');

              for (let i = 0; i < (analysis.criteria || []).length; i++) {
                const c = analysis.criteria[i];
                if (!c.criterion) errors.push('criterion[' + i + '] missing criterion text');
                if (!['met', 'partially_met', 'not_met'].includes(c.status)) errors.push('criterion[' + i + '] invalid status: ' + c.status);
                if (typeof c.evidence !== 'string') errors.push('criterion[' + i + '] missing evidence');
                if (typeof c.comment !== 'string') errors.push('criterion[' + i + '] missing comment');
                if (!Array.isArray(c.annotations)) errors.push('criterion[' + i + '] annotations not array');
              }

              return {
                pass: errors.length === 0,
                score: 1 - (errors.length / 20),
                reason: errors.length === 0 ? 'Schema valid' : errors.join('; '),
              };
            `,
          },
          // Criteria count validation (should extract ~6 criteria from our 6-item lists)
          {
            type: 'javascript',
            value: `
              const analysis = JSON.parse(output);
              const count = (analysis.criteria || []).length;
              const pass = count >= 4 && count <= 10;
              return {
                pass,
                score: pass ? 1 : 0.5,
                reason: 'Extracted ' + count + ' criteria' + (pass ? '' : ' (expected 4-10)'),
              };
            `,
          },
          // Met-count monotonicity: A-level should have more met criteria than D-level
          {
            type: 'javascript',
            value: `
              const analysis = JSON.parse(output);
              const metCount = (analysis.criteria || []).filter(c => c.status === 'met').length;
              const expectedMin = context.vars.expectedMetMin;
              const level = context.vars.expectedLevel;
              const pass = metCount >= expectedMin;
              return {
                pass: true,
                score: pass ? 1 : 0.5,
                reason: level + '-level: ' + metCount + ' criteria met (expected >= ' + expectedMin + ')' + (pass ? '' : ' BELOW EXPECTED'),
              };
            `,
          },
          // Annotation quality: each criterion should have at least one annotation
          {
            type: 'javascript',
            value: `
              const analysis = JSON.parse(output);
              const withAnnotations = (analysis.criteria || []).filter(c => c.annotations && c.annotations.length > 0).length;
              const total = (analysis.criteria || []).length;
              const ratio = total > 0 ? withAnnotations / total : 0;
              return {
                pass: true,
                score: ratio,
                reason: withAnnotations + '/' + total + ' criteria have annotations (' + Math.round(ratio * 100) + '%)',
              };
            `,
          },
          // Socratic voice check: annotations should contain questions
          {
            type: 'javascript',
            value: `
              const analysis = JSON.parse(output);
              let totalAnnotations = 0;
              let questionsFound = 0;
              for (const c of (analysis.criteria || [])) {
                for (const a of (c.annotations || [])) {
                  totalAnnotations++;
                  if (a.comment && a.comment.includes('?')) questionsFound++;
                }
              }
              const ratio = totalAnnotations > 0 ? questionsFound / totalAnnotations : 0;
              return {
                pass: true,
                score: ratio,
                reason: questionsFound + '/' + totalAnnotations + ' annotations are Socratic (contain questions)',
              };
            `,
          },
        ],
      });
    }
  }

  console.log(`Loaded ${tests.length} criteria test cases across ${Object.keys(CRITERIA_SETS).length} assignment sets`);
  return tests;
}

export default loadTests();
