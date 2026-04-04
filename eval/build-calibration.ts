import { readFileSync, readdirSync, writeFileSync, mkdirSync } from 'fs';
import { resolve, dirname, basename } from 'path';

const TEST_ESSAYS_DIR = resolve(dirname(new URL(import.meta.url).pathname), '../functions/test-essays');
const OUTPUT_PATH = resolve(dirname(new URL(import.meta.url).pathname), 'datasets/calibration.json');

interface CalibrationEssay {
  filename: string;
  content: string;
  writingType: string;
  assignmentPrompt: string;
  expectedAvgScoreRange: [number, number] | null;
  scoreSource: string | null;
}

const OREGON_LEVEL_RANGES: Record<string, [number, number]> = {
  exceeds: [5, 6],
  meets: [3, 5],
  approaching: [2, 4],
  doesnotmeet: [1, 3],
};

function actScoreRange(n: number): [number, number] {
  return [Math.max(1, n - 1), Math.min(6, n + 1)];
}

const PROMPTS: Record<string, string> = {
  'act-machines': 'Intelligent machines challenge our long-standing ideas about what humans are or can be. Write a unified, coherent essay about what you think about intelligent machines.',
  'oregon-3dprinters': 'Write an argumentative essay about 3D printers, using evidence from the provided sources.',
  'oregon-geocaching': 'Write an informational essay about geocaching, using evidence from the provided sources.',
  'oregon-sunflower': 'Write an informational essay about sunflowers, using evidence from the provided sources.',
  'grade9-civil-disobedience': 'Write an analytical essay examining the concept of civil disobedience.',
  'grade11-marching': 'Write an analytical essay about the text.',
  'grade12-freedom': 'Write an analytical essay about the text.',
  'hayes-letter': 'Write a letter.',
};

function main() {
  const files = readdirSync(TEST_ESSAYS_DIR).filter(f => f.endsWith('.txt')).sort();
  const essays: CalibrationEssay[] = [];

  for (const filename of files) {
    const content = readFileSync(resolve(TEST_ESSAYS_DIR, filename), 'utf-8');
    const name = basename(filename, '.txt');

    let writingType = 'argumentative';
    let assignmentPrompt = '';
    let expectedAvgScoreRange: [number, number] | null = null;
    let scoreSource: string | null = null;

    const actMatch = name.match(/^act-machines-score(\d)$/);
    if (actMatch) {
      const n = parseInt(actMatch[1], 10);
      expectedAvgScoreRange = actScoreRange(n);
      scoreSource = `ACT score ${n}`;
      assignmentPrompt = PROMPTS['act-machines'];
      writingType = 'argumentative';
    }

    const oregonMatch = name.match(/^oregon-(\w+)-[A-D]-(\w+)$/);
    if (oregonMatch) {
      const topic = oregonMatch[1];
      const level = oregonMatch[2];
      expectedAvgScoreRange = OREGON_LEVEL_RANGES[level] || null;
      scoreSource = `Oregon DOE ${level}`;
      assignmentPrompt = PROMPTS[`oregon-${topic}`] || `Write about ${topic}.`;
      writingType = topic === '3dprinters' ? 'argumentative' : 'expository';
    }

    const gradeMatch = name.match(/^grade(\d+)/);
    if (gradeMatch) {
      assignmentPrompt = PROMPTS[name] || PROMPTS[name.replace(/-.*/, '')] || 'Write an analytical essay.';
      writingType = 'analytical';
      scoreSource = null;
      expectedAvgScoreRange = null;
    }

    if (name === 'hayes-letter') {
      assignmentPrompt = PROMPTS['hayes-letter'];
      writingType = 'narrative';
      scoreSource = null;
      expectedAvgScoreRange = null;
    }

    essays.push({ filename, content, writingType, assignmentPrompt, expectedAvgScoreRange, scoreSource });
  }

  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, JSON.stringify(essays, null, 2));

  console.log(`Generated ${essays.length} calibration essays to ${OUTPUT_PATH}`);
  console.log(`  With expected scores: ${essays.filter(e => e.expectedAvgScoreRange).length}`);
  console.log(`  Without expected scores: ${essays.filter(e => !e.expectedAvgScoreRange).length}`);
}

main();
