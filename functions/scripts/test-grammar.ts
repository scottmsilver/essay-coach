/**
 * Test script: Can Gemini handle comprehensive single-pass grammar analysis?
 *
 * Tests whether one Gemini call can cover both sentence-level mechanics
 * AND higher-order patterns with sufficient quality, or if we need two
 * separate passes.
 *
 * Usage:
 *   GEMINI_API_KEY=xxx npx tsx scripts/test-grammar.ts
 */

import { GoogleGenAI } from '@google/genai';

// ── Sample essays ──────────────────────────────────────────────────────────

/** Same mediocre Gatsby essay used in test-evaluate.ts */
const SAMPLE_ESSAY = `The Great Gatsby by F. Scott Fitzgerald is a novel about the American Dream. In the novel, Jay Gatsby is a man who wants to achieve the American Dream. He throws big parties and has a lot of money. He is in love with Daisy Buchanan.

The American Dream is the idea that anyone can succeed in America if they work hard enough. Gatsby worked very hard to get rich. He came from a poor family but he made a lot of money. This shows that the American Dream is possible.

However, Gatsby's dream didn't come true in the end. He wanted Daisy to love him but she chose Tom instead. This shows that money can't buy everything. Gatsby died at the end of the book which is very sad.

In conclusion, The Great Gatsby shows us that the American Dream is complicated. Sometimes you can achieve your dreams and sometimes you can't. Fitzgerald wrote this book to show us that we should be careful what we wish for. The American Dream is still important today because many people still want to be successful.`;

/**
 * Deliberately error-heavy argumentative essay about social media.
 * Planted errors:
 *  - 2 comma splices (sentences 2, 5)
 *  - 1 run-on sentence (sentence 7)
 *  - 1 fragment (sentence 10)
 *  - 2 subject-verb agreement errors (sentences 3, 12)
 *  - 1 pronoun reference issue (sentence 8)
 *  - 1 tense shift (sentence 9)
 *  - 1 parallelism error (sentence 11)
 *  - 2 passive voice instances (sentences 6, 14)
 *  - Varied sentence lengths throughout
 */
const ERROR_HEAVY_ESSAY = `Social media has fundamentally changed how teenagers communicate with each other and with the broader world. Many parents worry about screen time, they believe their children are addicted to their phones. The number of hours students spend online are staggering, often exceeding five hours per day on platforms like Instagram, TikTok, and Snapchat.

Supporters of social media argue that it builds community and gives young people a voice. However, the evidence suggest that excessive use correlates with rising rates of anxiety and depression among adolescents. Studies have shown that self-esteem is damaged by constant comparison to curated online personas. Cyberbullying is another serious concern it affects roughly one in three teenagers and the psychological consequences can last well into adulthood and many victims never report the abuse to an adult or authority figure.

When a student posts something online, it can follow them forever. This is particularly troubling because they don't always understand the consequences. In the past, teenagers made mistakes that were forgotten over time, but today every embarrassing moment is captured and stays on the internet permanently. Especially when no one teaches digital literacy in schools. Social media companies should be required to limiting screen time for minors, providing clear privacy settings, and to educate users about data collection. Each of these platforms have a responsibility to protect their youngest users.

In conclusion, while social media offers genuine benefits for connection and self-expression, the risks to adolescent mental health cannot be ignored. Stronger regulations are needed by lawmakers to ensure that young people can participate in digital spaces safely. We must act now before an entire generation is shaped by algorithms designed not for their wellbeing but for corporate profit.`;

// ── Schema ──────────────────────────────────────────────────────────────────

const ISSUE_LOCATION_SCHEMA = {
  type: 'object' as const,
  properties: {
    sentence: { type: 'string' as const },
    quotedText: { type: 'string' as const },
    comment: { type: 'string' as const },
    severity: { type: 'string' as const, enum: ['error', 'warning', 'pattern'] },
  },
  required: ['sentence', 'quotedText', 'comment', 'severity'],
};

const ISSUE_CATEGORY_SCHEMA = {
  type: 'object' as const,
  properties: {
    locations: {
      type: 'array' as const,
      items: ISSUE_LOCATION_SCHEMA,
    },
  },
  required: ['locations'],
};

const PASSIVE_INSTANCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    quotedText: { type: 'string' as const },
    comment: { type: 'string' as const },
  },
  required: ['quotedText', 'comment'],
};

const MODIFIER_ISSUE_SCHEMA = {
  type: 'object' as const,
  properties: {
    quotedText: { type: 'string' as const },
    comment: { type: 'string' as const },
  },
  required: ['quotedText', 'comment'],
};

const WORDINESS_INSTANCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    quotedText: { type: 'string' as const },
    comment: { type: 'string' as const },
  },
  required: ['quotedText', 'comment'],
};

const GRAMMAR_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    // Sentence-level mechanics
    commaSplices: ISSUE_CATEGORY_SCHEMA,
    runOnSentences: ISSUE_CATEGORY_SCHEMA,
    fragments: ISSUE_CATEGORY_SCHEMA,
    subjectVerbAgreement: ISSUE_CATEGORY_SCHEMA,
    pronounReference: ISSUE_CATEGORY_SCHEMA,
    verbTenseConsistency: ISSUE_CATEGORY_SCHEMA,
    parallelStructure: ISSUE_CATEGORY_SCHEMA,
    punctuationErrors: ISSUE_CATEGORY_SCHEMA,
    missingCommas: ISSUE_CATEGORY_SCHEMA,

    // Higher-order patterns
    sentenceVariety: {
      type: 'object' as const,
      properties: {
        avgLength: { type: 'number' as const },
        distribution: {
          type: 'object' as const,
          properties: {
            simple: { type: 'number' as const },
            compound: { type: 'number' as const },
            complex: { type: 'number' as const },
            compoundComplex: { type: 'number' as const },
          },
          required: ['simple', 'compound', 'complex', 'compoundComplex'],
        },
        comment: { type: 'string' as const },
      },
      required: ['avgLength', 'distribution', 'comment'],
    },
    activePassiveVoice: {
      type: 'object' as const,
      properties: {
        activeCount: { type: 'number' as const },
        passiveCount: { type: 'number' as const },
        passiveInstances: {
          type: 'array' as const,
          items: PASSIVE_INSTANCE_SCHEMA,
        },
      },
      required: ['activeCount', 'passiveCount', 'passiveInstances'],
    },
    modifierPlacement: {
      type: 'object' as const,
      properties: {
        issues: {
          type: 'array' as const,
          items: MODIFIER_ISSUE_SCHEMA,
        },
      },
      required: ['issues'],
    },
    wordiness: {
      type: 'object' as const,
      properties: {
        instances: {
          type: 'array' as const,
          items: WORDINESS_INSTANCE_SCHEMA,
        },
      },
      required: ['instances'],
    },

    // Summary
    summary: {
      type: 'object' as const,
      properties: {
        totalErrors: { type: 'number' as const },
        errorsByCategory: {
          type: 'object' as const,
          properties: {
            commaSplices: { type: 'number' as const },
            runOnSentences: { type: 'number' as const },
            fragments: { type: 'number' as const },
            subjectVerbAgreement: { type: 'number' as const },
            pronounReference: { type: 'number' as const },
            verbTenseConsistency: { type: 'number' as const },
            parallelStructure: { type: 'number' as const },
            punctuationErrors: { type: 'number' as const },
            missingCommas: { type: 'number' as const },
          },
          required: [
            'commaSplices', 'runOnSentences', 'fragments',
            'subjectVerbAgreement', 'pronounReference', 'verbTenseConsistency',
            'parallelStructure', 'punctuationErrors', 'missingCommas',
          ],
        },
        overallComment: { type: 'string' as const },
        strengthAreas: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
        priorityFixes: {
          type: 'array' as const,
          items: { type: 'string' as const },
        },
      },
      required: ['totalErrors', 'errorsByCategory', 'overallComment', 'strengthAreas', 'priorityFixes'],
    },
  },
  required: [
    'commaSplices', 'runOnSentences', 'fragments',
    'subjectVerbAgreement', 'pronounReference', 'verbTenseConsistency',
    'parallelStructure', 'punctuationErrors', 'missingCommas',
    'sentenceVariety', 'activePassiveVoice', 'modifierPlacement', 'wordiness',
    'summary',
  ],
};

// ── System prompt ──────────────────────────────────────────────────────────

const GRAMMAR_SYSTEM_PROMPT = `You are an expert English grammar and writing mechanics analyst for high school and college students. Your job is to perform a comprehensive grammar analysis of a student essay in a single pass, covering both sentence-level mechanics and higher-order writing patterns.

## Your analysis must cover:

### Sentence-level mechanics (errors)
Identify specific errors by quoting the EXACT text from the essay. Categories:
- **Comma splices**: Two independent clauses joined only by a comma
- **Run-on sentences**: Two or more independent clauses with no punctuation or conjunction between them, OR excessively long sentences that fuse multiple independent clauses
- **Fragments**: Incomplete sentences lacking a subject, verb, or complete thought
- **Subject-verb agreement**: Subject and verb don't match in number
- **Pronoun reference**: Ambiguous, vague, or incorrect pronoun antecedents
- **Verb tense consistency**: Unnecessary shifts in verb tense
- **Parallel structure**: Items in a list or comparison not in the same grammatical form
- **Punctuation errors**: Misused semicolons, apostrophes, colons, etc.
- **Missing commas**: After introductory elements, in compound sentences, around nonessential clauses, in lists

### Higher-order patterns
- **Sentence variety**: Count sentence types (simple, compound, complex, compound-complex), calculate average length, comment on variety
- **Active vs. passive voice**: Count each, identify all passive instances with quotes
- **Modifier placement**: Dangling or misplaced modifiers
- **Wordiness**: Unnecessarily wordy or redundant phrases

## Severity levels
- **error**: Definitively grammatically wrong. A teacher would mark this.
- **warning**: Likely wrong or very awkward. Most teachers would flag this.
- **pattern**: Not technically wrong, but a stylistic observation worth noting (e.g., overuse of passive voice, repetitive sentence structure).

## Feedback style
- ALWAYS quote the exact text from the essay that contains the issue
- Identify WHAT the error is clearly — do not be vague
- Then use Socratic guidance: ask a question that helps the student figure out how to fix it
- Example: "In 'The dogs runs fast,' the subject 'dogs' is plural, but the verb 'runs' is singular. What form of the verb would match a plural subject?"
- For higher-order patterns, explain what you observe and ask how the student might improve it

## Important rules
- Do NOT invent errors that aren't there. Only flag genuine issues.
- Do NOT flag correct grammar as incorrect. When in doubt, leave it out.
- Quote text EXACTLY as it appears in the essay — do not paraphrase or modify quotes.
- For the summary, count only items with severity 'error' or 'warning' toward totalErrors.
- priorityFixes should list the top 3 most important things to fix first.
- strengthAreas should highlight 2-3 things the student does well mechanically.`;

// ── Build prompt ───────────────────────────────────────────────────────────

function buildGrammarPrompt(essay: string): string {
  return `Perform a comprehensive grammar and mechanics analysis of this student essay. Identify all errors and patterns as specified.

Here is the essay:

---
${essay}
---

Analyze every sentence carefully. Quote the exact text for each issue you find.`;
}

// ── Pretty print ───────────────────────────────────────────────────────────

interface IssueLocation {
  sentence: string;
  quotedText: string;
  comment: string;
  severity: string;
}

interface GrammarAnalysis {
  commaSplices: { locations: IssueLocation[] };
  runOnSentences: { locations: IssueLocation[] };
  fragments: { locations: IssueLocation[] };
  subjectVerbAgreement: { locations: IssueLocation[] };
  pronounReference: { locations: IssueLocation[] };
  verbTenseConsistency: { locations: IssueLocation[] };
  parallelStructure: { locations: IssueLocation[] };
  punctuationErrors: { locations: IssueLocation[] };
  missingCommas: { locations: IssueLocation[] };
  sentenceVariety: {
    avgLength: number;
    distribution: { simple: number; compound: number; complex: number; compoundComplex: number };
    comment: string;
  };
  activePassiveVoice: {
    activeCount: number;
    passiveCount: number;
    passiveInstances: { quotedText: string; comment: string }[];
  };
  modifierPlacement: { issues: { quotedText: string; comment: string }[] };
  wordiness: { instances: { quotedText: string; comment: string }[] };
  summary: {
    totalErrors: number;
    errorsByCategory: Record<string, number>;
    overallComment: string;
    strengthAreas: string[];
    priorityFixes: string[];
  };
}

const SEVERITY_ICONS: Record<string, string> = {
  error: '[ERROR]',
  warning: '[WARN]',
  pattern: '[PATTERN]',
};

function printIssueCategory(name: string, locations: IssueLocation[]) {
  if (!locations || locations.length === 0) {
    console.log(`  ${name}: (none found)`);
    return;
  }
  console.log(`  ${name}: ${locations.length} issue(s)`);
  for (const loc of locations) {
    const icon = SEVERITY_ICONS[loc.severity] || '[?]';
    console.log(`    ${icon} "${loc.quotedText}"`);
    console.log(`      ${loc.comment}`);
    console.log('');
  }
}

function printResults(label: string, analysis: GrammarAnalysis, elapsedMs: number) {
  const divider = '='.repeat(70);
  console.log(`\n${divider}`);
  console.log(`  GRAMMAR ANALYSIS: ${label}`);
  console.log(`  (completed in ${(elapsedMs / 1000).toFixed(1)}s)`);
  console.log(`${divider}\n`);

  // ── Sentence-level mechanics ──
  console.log('--- SENTENCE-LEVEL MECHANICS ---\n');
  const mechanicsCategories: [string, IssueLocation[]][] = [
    ['Comma Splices', analysis.commaSplices?.locations],
    ['Run-on Sentences', analysis.runOnSentences?.locations],
    ['Fragments', analysis.fragments?.locations],
    ['Subject-Verb Agreement', analysis.subjectVerbAgreement?.locations],
    ['Pronoun Reference', analysis.pronounReference?.locations],
    ['Verb Tense Consistency', analysis.verbTenseConsistency?.locations],
    ['Parallel Structure', analysis.parallelStructure?.locations],
    ['Punctuation Errors', analysis.punctuationErrors?.locations],
    ['Missing Commas', analysis.missingCommas?.locations],
  ];

  for (const [name, locations] of mechanicsCategories) {
    printIssueCategory(name, locations || []);
  }

  // ── Higher-order patterns ──
  console.log('\n--- HIGHER-ORDER PATTERNS ---\n');

  // Sentence variety
  const sv = analysis.sentenceVariety;
  if (sv) {
    console.log('  Sentence Variety:');
    console.log(`    Average length: ${sv.avgLength} words`);
    console.log(`    Distribution: Simple=${sv.distribution.simple}, Compound=${sv.distribution.compound}, Complex=${sv.distribution.complex}, Compound-Complex=${sv.distribution.compoundComplex}`);
    console.log(`    Comment: ${sv.comment}`);
    console.log('');
  }

  // Active/Passive
  const ap = analysis.activePassiveVoice;
  if (ap) {
    console.log('  Active vs. Passive Voice:');
    console.log(`    Active: ${ap.activeCount}, Passive: ${ap.passiveCount}`);
    if (ap.passiveInstances?.length) {
      console.log('    Passive instances:');
      for (const inst of ap.passiveInstances) {
        console.log(`      "${inst.quotedText}"`);
        console.log(`        ${inst.comment}`);
      }
    }
    console.log('');
  }

  // Modifier placement
  const mp = analysis.modifierPlacement;
  if (mp?.issues?.length) {
    console.log('  Modifier Placement Issues:');
    for (const issue of mp.issues) {
      console.log(`    "${issue.quotedText}"`);
      console.log(`      ${issue.comment}`);
    }
    console.log('');
  } else {
    console.log('  Modifier Placement: (no issues found)\n');
  }

  // Wordiness
  const w = analysis.wordiness;
  if (w?.instances?.length) {
    console.log('  Wordiness:');
    for (const inst of w.instances) {
      console.log(`    "${inst.quotedText}"`);
      console.log(`      ${inst.comment}`);
    }
    console.log('');
  } else {
    console.log('  Wordiness: (no issues found)\n');
  }

  // ── Summary ──
  console.log('--- SUMMARY ---\n');
  const s = analysis.summary;
  if (s) {
    console.log(`  Total errors (error + warning): ${s.totalErrors}`);
    console.log('  Errors by category:');
    for (const [cat, count] of Object.entries(s.errorsByCategory)) {
      if (count > 0) {
        console.log(`    ${cat}: ${count}`);
      }
    }
    console.log(`\n  Overall: ${s.overallComment}`);
    console.log('\n  Strengths:');
    for (const str of s.strengthAreas || []) {
      console.log(`    + ${str}`);
    }
    console.log('\n  Priority fixes:');
    for (let i = 0; i < (s.priorityFixes || []).length; i++) {
      console.log(`    ${i + 1}. ${s.priorityFixes[i]}`);
    }
  }

  console.log(`\n${divider}\n`);
}

// ── Main ────────────────────────────────────────────────────────────────────

async function analyzeEssay(
  ai: InstanceType<typeof GoogleGenAI>,
  label: string,
  essay: string,
): Promise<{ analysis: GrammarAnalysis; elapsedMs: number }> {
  const wordCount = essay.trim().split(/\s+/).length;
  console.log(`\nAnalyzing: ${label}`);
  console.log(`Word count: ${wordCount}`);
  console.log('Calling Gemini (with thinking enabled)...\n');

  const prompt = buildGrammarPrompt(essay);
  const start = Date.now();

  const stream = await ai.models.generateContentStream({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: GRAMMAR_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: GRAMMAR_ANALYSIS_SCHEMA,
      thinkingConfig: { includeThoughts: true },
    },
  });

  let outputText = '';
  let thinkingText = '';
  let stage: 'thinking' | 'generating' = 'thinking';

  for await (const chunk of stream) {
    const parts = chunk.candidates?.[0]?.content?.parts || [];
    for (const part of parts) {
      if (part.thought) {
        thinkingText += part.text || '';
        if (stage === 'thinking') {
          // Show a dot for progress
          process.stdout.write('.');
        }
      } else {
        if (stage === 'thinking') {
          stage = 'generating';
          process.stdout.write(' [generating] ');
        }
        outputText += part.text || '';
        process.stdout.write('.');
      }
    }
  }

  const elapsedMs = Date.now() - start;
  console.log(` done (${(elapsedMs / 1000).toFixed(1)}s)\n`);

  // Show thinking summary
  const thinkingLines = thinkingText.trim().split('\n').filter(l => l.trim());
  if (thinkingLines.length > 0) {
    console.log(`  Thinking: ${thinkingLines.length} lines of reasoning`);
    // Show first few lines
    for (let i = 0; i < Math.min(5, thinkingLines.length); i++) {
      console.log(`    > ${thinkingLines[i].slice(0, 120)}`);
    }
    if (thinkingLines.length > 5) {
      console.log(`    > ... (${thinkingLines.length - 5} more lines)`);
    }
  }

  if (!outputText) {
    throw new Error('Gemini returned an empty response');
  }

  const analysis = JSON.parse(outputText) as GrammarAnalysis;
  return { analysis, elapsedMs };
}

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('Error: GEMINI_API_KEY env var is required.');
    console.error('Usage: GEMINI_API_KEY=$(firebase functions:secrets:access GEMINI_API_KEY --project essay-grader-83737x 2>/dev/null) npx tsx scripts/test-grammar.ts');
    process.exit(1);
  }

  const ai = new GoogleGenAI({ apiKey });

  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   GRAMMAR ANALYSIS TEST: Single-pass mechanics + patterns           ║');
  console.log('║   Model: gemini-3.1-pro-preview | Structured JSON | Thinking: ON    ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝');

  // ── Test 1: Sample essay (mediocre Gatsby analysis) ──
  const result1 = await analyzeEssay(ai, 'Sample Gatsby Essay (mediocre student writing)', SAMPLE_ESSAY);
  printResults('SAMPLE GATSBY ESSAY', result1.analysis, result1.elapsedMs);

  // ── Test 2: Error-heavy social media essay ──
  const result2 = await analyzeEssay(ai, 'Error-Heavy Social Media Essay (planted errors)', ERROR_HEAVY_ESSAY);
  printResults('ERROR-HEAVY SOCIAL MEDIA ESSAY', result2.analysis, result2.elapsedMs);

  // ── Error detection audit for essay 2 ──
  console.log('╔══════════════════════════════════════════════════════════════════════╗');
  console.log('║   PLANTED ERROR DETECTION AUDIT (Error-Heavy Essay)                 ║');
  console.log('╚══════════════════════════════════════════════════════════════════════╝\n');

  const a = result2.analysis;
  const audit: [string, string, boolean][] = [
    ['Comma splice 1', '"they believe their children are addicted"', (a.commaSplices?.locations?.length || 0) >= 1],
    ['Comma splice 2', '"evidence suggest" context', (a.commaSplices?.locations?.length || 0) >= 2],
    ['Run-on sentence', '"Cyberbullying is another serious concern it affects..."', (a.runOnSentences?.locations?.length || 0) >= 1],
    ['Fragment', '"Especially when no one teaches digital literacy"', (a.fragments?.locations?.length || 0) >= 1],
    ['SVA error 1', '"are staggering" (number...are)', (a.subjectVerbAgreement?.locations?.length || 0) >= 1],
    ['SVA error 2', '"have a responsibility" (each...have)', (a.subjectVerbAgreement?.locations?.length || 0) >= 2],
    ['Pronoun reference', '"they don\'t always understand"', (a.pronounReference?.locations?.length || 0) >= 1],
    ['Tense shift', '"made mistakes...is captured and stays"', (a.verbTenseConsistency?.locations?.length || 0) >= 1],
    ['Parallelism', '"limiting...providing...to educate"', (a.parallelStructure?.locations?.length || 0) >= 1],
    ['Passive voice', '"is damaged", "are needed"', (a.activePassiveVoice?.passiveInstances?.length || 0) >= 2],
  ];

  let detected = 0;
  for (const [errorName, hint, found] of audit) {
    const status = found ? 'FOUND' : 'MISSED';
    console.log(`  [${status}] ${errorName} — ${hint}`);
    if (found) detected++;
  }

  console.log(`\n  Detection rate: ${detected}/${audit.length} planted errors found (${Math.round(detected / audit.length * 100)}%)\n`);

  // Total time
  const totalTime = result1.elapsedMs + result2.elapsedMs;
  console.log(`Total time for both essays: ${(totalTime / 1000).toFixed(1)}s`);
  console.log(`Average per essay: ${(totalTime / 2000).toFixed(1)}s\n`);

  // Dump raw JSON
  console.log('\n═══ RAW JSON: Sample Essay ═══');
  console.log(JSON.stringify(result1.analysis, null, 2));
  console.log('\n═══ RAW JSON: Error-Heavy Essay ═══');
  console.log(JSON.stringify(result2.analysis, null, 2));
}

main().catch((err) => {
  console.error('Error:', err.message || err);
  if (err.stack) console.error(err.stack);
  process.exit(1);
});
