/**
 * CLI test harness for essay evaluation.
 *
 * Usage:
 *   npx tsx scripts/test-evaluate.ts [essay-file] [--type argumentative] [--prompt "..."]
 *   npx tsx scripts/test-evaluate.ts --sample          # use built-in sample essay
 *   npx tsx scripts/test-evaluate.ts essay.txt          # read essay from file
 *   echo "essay text" | npx tsx scripts/test-evaluate.ts --stdin
 *
 * Requires GEMINI_API_KEY env var (or reads from .env in functions/).
 */

import { readFileSync, existsSync } from 'fs';
import { SYSTEM_PROMPT, buildEvaluationPrompt } from '../src/prompt';
import { GoogleGenAI } from '@google/genai';

// ── Config ──────────────────────────────────────────────────────────────────

const SAMPLE_ESSAY = `The Great Gatsby by F. Scott Fitzgerald is a novel about the American Dream. In the novel, Jay Gatsby is a man who wants to achieve the American Dream. He throws big parties and has a lot of money. He is in love with Daisy Buchanan.

The American Dream is the idea that anyone can succeed in America if they work hard enough. Gatsby worked very hard to get rich. He came from a poor family but he made a lot of money. This shows that the American Dream is possible.

However, Gatsby's dream didn't come true in the end. He wanted Daisy to love him but she chose Tom instead. This shows that money can't buy everything. Gatsby died at the end of the book which is very sad.

In conclusion, The Great Gatsby shows us that the American Dream is complicated. Sometimes you can achieve your dreams and sometimes you can't. Fitzgerald wrote this book to show us that we should be careful what we wish for. The American Dream is still important today because many people still want to be successful.`;

const SAMPLE_PROMPT = 'Analyze how F. Scott Fitzgerald uses symbolism to explore the corruption of the American Dream in The Great Gatsby. Use specific textual evidence to support your argument.';

// ── Parse args ──────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let essayContent = '';
  let writingType = 'argumentative';
  let assignmentPrompt = SAMPLE_PROMPT;
  let useSample = false;
  let useStdin = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case '--sample':
        useSample = true;
        break;
      case '--stdin':
        useStdin = true;
        break;
      case '--type':
        writingType = args[++i];
        break;
      case '--prompt':
        assignmentPrompt = args[++i];
        break;
      default:
        // Treat as file path
        if (existsSync(args[i])) {
          essayContent = readFileSync(args[i], 'utf-8');
        } else {
          console.error(`File not found: ${args[i]}`);
          process.exit(1);
        }
    }
  }

  if (useStdin) {
    essayContent = readFileSync(0, 'utf-8');
  } else if (useSample || !essayContent) {
    if (!essayContent) useSample = true;
    essayContent = SAMPLE_ESSAY;
  }

  return { essayContent, writingType, assignmentPrompt, useSample };
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY env var is required.');
    console.error('Usage: GEMINI_API_KEY=xxx npx tsx scripts/test-evaluate.ts --sample');
    process.exit(1);
  }

  const { essayContent, writingType, assignmentPrompt, useSample } = parseArgs();

  if (useSample) {
    console.log('═══ Using built-in sample essay (mediocre Gatsby analysis) ═══\n');
  }

  const wordCount = essayContent.trim().split(/\s+/).length;
  console.log(`Writing type: ${writingType}`);
  console.log(`Word count: ${wordCount}`);
  console.log(`Assignment: ${assignmentPrompt.slice(0, 80)}...`);
  console.log('');
  console.log('Evaluating with Gemini...\n');

  const prompt = buildEvaluationPrompt({
    assignmentPrompt,
    writingType,
    content: essayContent,
  });

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: {
        type: 'object' as const,
        properties: {
          traits: {
            type: 'object' as const,
            properties: Object.fromEntries(
              ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'].map(
                (trait) => [
                  trait,
                  {
                    type: 'object' as const,
                    properties: {
                      score: { type: 'number' as const },
                      feedback: { type: 'string' as const },
                      revisionPriority: { type: 'number' as const, nullable: true },
                      annotations: {
                        type: 'array' as const,
                        items: {
                          type: 'object' as const,
                          properties: {
                            quotedText: { type: 'string' as const },
                            comment: { type: 'string' as const },
                          },
                          required: ['quotedText', 'comment'],
                        },
                      },
                    },
                    required: ['score', 'feedback', 'revisionPriority', 'annotations'],
                  },
                ]
              )
            ),
            required: ['ideas', 'organization', 'voice', 'wordChoice', 'sentenceFluency', 'conventions', 'presentation'],
          },
          overallFeedback: { type: 'string' as const },
          revisionPlan: { type: 'array' as const, items: { type: 'string' as const } },
          comparisonToPrevious: {
            type: 'object' as const,
            nullable: true,
            properties: {
              scoreChanges: { type: 'object' as const },
              improvements: { type: 'array' as const, items: { type: 'string' as const } },
              remainingIssues: { type: 'array' as const, items: { type: 'string' as const } },
            },
          },
        },
        required: ['traits', 'overallFeedback', 'revisionPlan', 'comparisonToPrevious'],
      },
    },
  });

  const text = response.text;
  if (!text) {
    console.error('Gemini returned an empty response');
    process.exit(1);
  }

  const evaluation = JSON.parse(text);

  // ── Pretty print ────────────────────────────────────────────────────────

  const TRAIT_LABELS: Record<string, string> = {
    ideas: 'Ideas',
    organization: 'Organization',
    voice: 'Voice',
    wordChoice: 'Word Choice',
    sentenceFluency: 'Sentence Fluency',
    conventions: 'Conventions',
    presentation: 'Presentation',
  };

  const SCORE_LABELS: Record<number, string> = {
    1: 'Beginning',
    2: 'Emerging',
    3: 'Developing',
    4: 'Capable',
    5: 'Experienced',
    6: 'Exceptional',
  };

  console.log('═══════════════════════════════════════════════════════════════');
  console.log('                    EVALUATION RESULTS');
  console.log('═══════════════════════════════════════════════════════════════\n');

  // Score summary
  const scores: number[] = [];
  for (const [key, label] of Object.entries(TRAIT_LABELS)) {
    const trait = evaluation.traits[key];
    if (!trait) continue;
    scores.push(trait.score);
    const scoreLabel = SCORE_LABELS[trait.score] || '?';
    const bar = '█'.repeat(trait.score) + '░'.repeat(6 - trait.score);
    const priority = trait.revisionPriority ? ` ← revision #${trait.revisionPriority}` : '';
    console.log(`  ${label.padEnd(18)} ${bar} ${trait.score}/6 (${scoreLabel})${priority}`);
  }

  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  console.log(`\n  ${'Average'.padEnd(18)} ${' '.repeat(7)} ${avg.toFixed(1)}/6\n`);

  // Detailed trait feedback
  for (const [key, label] of Object.entries(TRAIT_LABELS)) {
    const trait = evaluation.traits[key];
    if (!trait) continue;
    console.log(`───── ${label} (${trait.score}/6) ─────`);
    console.log(`${trait.feedback}\n`);
    if (trait.annotations?.length) {
      for (const ann of trait.annotations) {
        console.log(`  → "${ann.quotedText}"`);
        console.log(`    ${ann.comment}\n`);
      }
    }
  }

  // Overall feedback
  console.log('═══ Overall Feedback ═══');
  console.log(evaluation.overallFeedback);
  console.log('');

  // Revision plan
  if (evaluation.revisionPlan?.length) {
    console.log('═══ Revision Plan ═══');
    evaluation.revisionPlan.forEach((step: string, i: number) => {
      console.log(`  ${i + 1}. ${step}`);
    });
    console.log('');
  }

  // Also dump raw JSON for inspection
  console.log('═══ Raw JSON ═══');
  console.log(JSON.stringify(evaluation, null, 2));
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  process.exit(1);
});
