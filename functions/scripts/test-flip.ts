import { analyzeTransitionsWithGemini } from '../src/transitions';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const apiKey = process.argv[2];
if (!apiKey) { console.error('Usage: npx tsx scripts/test-flip.ts <GEMINI_API_KEY>'); process.exit(1); }

const essay = readFileSync(resolve(__dirname, '../test-essays/grade12-freedom-from-structure.txt'), 'utf-8');

async function main() {
  console.log('=== RUN 1 (no previous) ===');
  const run1 = await analyzeTransitionsWithGemini(apiKey, essay);
  const r1 = run1.sentenceTransitions.map(t => `¶${t.paragraph} S${t.fromSentence}→S${t.toSentence}: ${t.quality}`);
  console.log(r1.join('\n'));

  console.log('\n=== RUN 2 (no stabilization — raw Gemini) ===');
  const run2 = await analyzeTransitionsWithGemini(apiKey, essay);
  const r2 = run2.sentenceTransitions.map(t => `¶${t.paragraph} S${t.fromSentence}→S${t.toSentence}: ${t.quality}`);
  console.log(r2.join('\n'));

  // Show flips
  console.log('\n=== FLIPS (run1 vs run2, no stabilization) ===');
  let flips = 0;
  for (let i = 0; i < Math.min(r1.length, r2.length); i++) {
    if (r1[i] !== r2[i]) {
      console.log(`  FLIP: ${r1[i]}  →  ${r2[i].split(': ')[1]}`);
      flips++;
    }
  }
  if (r1.length !== r2.length) console.log(`  (different number of transitions: ${r1.length} vs ${r2.length})`);
  console.log(`${flips} flips out of ${Math.min(r1.length, r2.length)} transitions\n`);

  console.log('=== RUN 3 (WITH stabilization from run1) ===');
  const run3 = await analyzeTransitionsWithGemini(apiKey, essay, undefined, run1);
  const r3 = run3.sentenceTransitions.map(t => `¶${t.paragraph} S${t.fromSentence}→S${t.toSentence}: ${t.quality}`);
  console.log(r3.join('\n'));

  console.log('\n=== RESULT (run1 vs run3, WITH stabilization) ===');
  let stabilizedFlips = 0;
  for (let i = 0; i < Math.min(r1.length, r3.length); i++) {
    if (r1[i] !== r3[i]) {
      console.log(`  FLIP: ${r1[i]}  →  ${r3[i].split(': ')[1]}`);
      stabilizedFlips++;
    }
  }
  console.log(`${stabilizedFlips} flips out of ${Math.min(r1.length, r3.length)} transitions (should be 0)`);
}

main().catch(console.error);
