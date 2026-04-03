/**
 * Test the two-pass transition analysis.
 * Shows which weak/missing transitions get upgraded after contextual recheck.
 *
 * Usage: cd functions && GEMINI_API_KEY=... npx tsx scripts/test-two-pass.ts
 */
import { splitEssayIntoSentences, formatSentencesForPrompt, buildTransitionPrompt } from '../src/transitions';
import { streamGeminiJson } from '../src/streamGemini';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Import the system prompt and schema by reading the module internals
// We'll duplicate the essentials here to run pass 1 separately

const TRANSITION_SYSTEM_PROMPT = `You are an expert writing coach specializing in essay structure and flow. Your job is to analyze EVERY transition in a student's essay — between consecutive sentences and between paragraphs.

A "transition" is the seam between two adjacent units of text. Good transitions create flow; weak or missing transitions make writing feel choppy or disconnected.

## Rating scale
- **smooth**: Natural and invisible flow.
- **adequate**: Logical connection exists, could be stronger.
- **weak**: Connection unclear, abrupt, or relies on generic filler.
- **missing**: No discernible connection.

## Feedback style
Use Socratic questions. Do NOT rewrite text for the student.
For smooth transitions, explain WHY it works.`;

const TRANSITION_SCHEMA = {
  type: 'object' as const,
  properties: {
    sentenceTransitions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          paragraph: { type: 'number' as const },
          fromSentence: { type: 'number' as const },
          toSentence: { type: 'number' as const },
          quality: { type: 'string' as const, enum: ['smooth', 'adequate', 'weak', 'missing'] },
          comment: { type: 'string' as const },
        },
        required: ['paragraph', 'fromSentence', 'toSentence', 'quality', 'comment'],
      },
    },
    paragraphTransitions: {
      type: 'array' as const,
      items: {
        type: 'object' as const,
        properties: {
          fromParagraph: { type: 'number' as const },
          toParagraph: { type: 'number' as const },
          quality: { type: 'string' as const, enum: ['smooth', 'adequate', 'weak', 'missing'] },
          comment: { type: 'string' as const },
        },
        required: ['fromParagraph', 'toParagraph', 'quality', 'comment'],
      },
    },
    summary: { type: 'string' as const },
  },
  required: ['sentenceTransitions', 'paragraphTransitions', 'summary'],
};

const apiKey = process.env.GEMINI_API_KEY;
if (!apiKey) { console.error('Set GEMINI_API_KEY env var'); process.exit(1); }

const essay = readFileSync(resolve(__dirname, '../test-essays/grade12-freedom-from-structure.txt'), 'utf-8');

async function main() {
  // Split sentences
  console.log('Splitting sentences...');
  const sentences = await splitEssayIntoSentences(essay, apiKey);
  const formatted = formatSentencesForPrompt(sentences);

  // Pass 1: linear analysis
  console.log('\n=== PASS 1: Linear sentence-to-sentence ===');
  const prompt = buildTransitionPrompt(formatted);
  const pass1Text = await streamGeminiJson({
    apiKey: apiKey!,
    contents: prompt,
    systemInstruction: TRANSITION_SYSTEM_PROMPT,
    responseSchema: TRANSITION_SCHEMA,
    statusField: 'transitionStatus',
    generatingMessage: 'Pass 1...',
  });
  const pass1 = JSON.parse(pass1Text);

  // Show pass 1 results
  const flagged = pass1.sentenceTransitions.filter(
    (t: any) => t.quality === 'weak' || t.quality === 'missing'
  );
  console.log(`\nPass 1 found ${pass1.sentenceTransitions.length} sentence transitions:`);
  for (const t of pass1.sentenceTransitions) {
    const marker = (t.quality === 'weak' || t.quality === 'missing') ? ' ⚠️' : '';
    console.log(`  ¶${t.paragraph} S${t.fromSentence}→S${t.toSentence}: ${t.quality}${marker}`);
  }
  console.log(`\n${flagged.length} flagged as weak/missing → sending to Pass 2\n`);

  if (flagged.length === 0) {
    console.log('Nothing to recheck. Done.');
    return;
  }

  // Pass 2: contextual recheck
  console.log('=== PASS 2: Contextual recheck ===');
  const recheckItems: string[] = [];
  for (const t of flagged) {
    const paraKey = String(t.paragraph - 1);
    const paraSents = sentences[paraKey];
    if (!paraSents) continue;
    const id = `¶${t.paragraph}-S${t.fromSentence}-S${t.toSentence}`;
    const fullPara = paraSents.map((s: string, i: number) => `  S${i + 1}: "${s}"`).join('\n');
    recheckItems.push(
      `ID: ${id}\nPass 1 rating: ${t.quality}\nPass 1 comment: ${t.comment}\nFlagged pair: S${t.fromSentence + 1} → S${t.toSentence + 1}\nFull paragraph ¶${t.paragraph}:\n${fullPara}`
    );
  }

  const recheckPrompt = `Re-evaluate these ${flagged.length} transitions that Pass 1 flagged as weak or missing. For each one, read the full paragraph context and decide if the connection is actually made through an earlier sentence.\n\n${recheckItems.join('\n\n---\n\n')}`;

  const recheckText = await streamGeminiJson({
    apiKey: apiKey!,
    contents: recheckPrompt,
    systemInstruction: `You are a writing coach re-evaluating transition quality with full context.

Pass 1 flagged certain sentence transitions as "weak" or "missing" by looking only at adjacent sentence pairs. But essays often connect sentences through earlier context — a topic sentence, a shared theme, or a callback to a previous point.

Your job: for each flagged transition, read the FULL paragraph and decide if the connection is actually made through broader context.

For each item, return one of:
- "upgrade" — the broader context resolves the transition. Set newQuality to "adequate" or "smooth" and explain what connection Pass 1 missed.
- "keep" — it is genuinely weak/missing even in context. Keep the original rating.

Be honest. Only upgrade when there is a real contextual link.`,
    responseSchema: {
      type: 'object' as const,
      properties: {
        results: {
          type: 'array' as const,
          items: {
            type: 'object' as const,
            properties: {
              id: { type: 'string' as const },
              verdict: { type: 'string' as const, enum: ['upgrade', 'keep'] },
              newQuality: { type: 'string' as const, enum: ['smooth', 'adequate', 'weak', 'missing'] },
              reason: { type: 'string' as const },
            },
            required: ['id', 'verdict', 'newQuality', 'reason'],
          },
        },
      },
      required: ['results'],
    },
    statusField: 'transitionStatus',
    generatingMessage: 'Pass 2...',
  });

  const recheck = JSON.parse(recheckText);

  console.log('\nPass 2 results:');
  let upgrades = 0;
  for (const r of recheck.results) {
    const icon = r.verdict === 'upgrade' ? '✅ UPGRADE' : '❌ KEEP';
    console.log(`  ${r.id}: ${icon} → ${r.newQuality}`);
    console.log(`    ${r.reason}\n`);
    if (r.verdict === 'upgrade') upgrades++;
  }

  console.log(`\n=== SUMMARY ===`);
  console.log(`Pass 1: ${pass1.sentenceTransitions.length} transitions, ${flagged.length} flagged`);
  console.log(`Pass 2: ${upgrades} upgraded, ${flagged.length - upgrades} kept as weak/missing`);
  console.log(`False positive rate: ${((upgrades / flagged.length) * 100).toFixed(0)}% of flagged items were actually fine in context`);
}

main().catch(console.error);
