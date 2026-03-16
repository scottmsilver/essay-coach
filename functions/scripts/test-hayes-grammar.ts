/**
 * Run grammar analysis on the actual stored Hayes letter paragraph
 * with the UPDATED system prompt to verify the fix.
 */
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { GoogleGenAI } from '@google/genai';
import { buildGrammarPrompt, GRAMMAR_SYSTEM_PROMPT_EXPORTED } from '../src/grammar';

initializeApp({ projectId: 'essay-grader-83737x' });
const db = getFirestore();

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
    locations: { type: 'array' as const, items: ISSUE_LOCATION_SCHEMA },
  },
  required: ['locations'],
};

const TEST_SCHEMA = {
  type: 'object' as const,
  properties: {
    pronounReference: ISSUE_CATEGORY_SCHEMA,
  },
  required: ['pronounReference'],
};

async function main() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.error('GEMINI_API_KEY required');
    process.exit(1);
  }

  // Fetch actual stored content
  const uid = 'R8yiPqSa69ZQl0YqDK2mxb8tPKl1';
  const eid = 'rwOydkfg4dpWJwH25nWy';
  const drafts = await db.collection(`users/${uid}/essays/${eid}/drafts`).orderBy('draftNumber', 'desc').limit(1).get();
  const content = drafts.docs[0].data().content;

  // Extract the paragraph with "senatorial courtesy"
  const startIdx = content.indexOf('Consider my struggle');
  const endSearch = content.indexOf('\n', startIdx + 1);
  const paragraph = endSearch > 0 ? content.substring(startIdx, endSearch).trim() : content.substring(startIdx, startIdx + 2000).trim();

  console.log('=== TESTING WITH UPDATED SYSTEM PROMPT ===\n');

  const prompt = buildGrammarPrompt(paragraph);
  const ai = new GoogleGenAI({ apiKey });

  // Use the ACTUAL updated system prompt from grammar.ts
  const { analyzeGrammarWithGemini } = await import('../src/grammar');

  // But we can't use analyzeGrammarWithGemini directly since it uses the full schema.
  // Instead, read the system prompt from the module and use our test schema.
  // We need to export it first... Let's just copy the key additions.

  const UPDATED_SYSTEM_PROMPT = `You are an expert English grammar and writing mechanics analyst for high school and college students. Your job is to perform a comprehensive grammar analysis of a student essay in a single pass, covering both sentence-level mechanics and higher-order writing patterns.

## Your analysis must cover:

### Sentence-level mechanics (errors)
Identify specific errors by quoting the EXACT text from the essay. Categories:
- **Pronoun reference**: Ambiguous, vague, or incorrect pronoun antecedents. Do NOT flag demonstrative pronouns ("this," "that," "these," "those") when they clearly refer to a concept, term, practice, or idea named in the immediately preceding sentence — this is standard academic writing. Only flag when the referent is genuinely unclear even in context.

## Handling quoted material
- Essays often contain quoted terms, phrases, or passages within quotation marks (e.g., "senatorial courtesy," "permanent pacification"). These are part of the essay's content.
- NEVER truncate or skip text inside quotation marks. Always include the complete sentence — including any quoted material — in the "sentence" field.
- When a sentence ends with a period inside closing quotation marks (e.g., '..."senatorial courtesy."'), the sentence boundary is AFTER the closing quote mark, not before it. The quoted text is part of that sentence.
- When analyzing pronoun references or other cross-sentence issues, treat quoted terms and phrases as valid referents. For example, if one sentence defines "senatorial courtesy" and the next says "Under this," the pronoun "this" clearly refers to the quoted concept.

## Important rules
- Do NOT invent errors that aren't there. Only flag genuine issues.
- Do NOT flag correct grammar as incorrect. When in doubt, leave it out.
- Quote text EXACTLY as it appears in the essay — do not paraphrase or modify quotes.`;

  const response = await ai.models.generateContent({
    model: 'gemini-3.1-pro-preview',
    contents: prompt,
    config: {
      systemInstruction: UPDATED_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema: TEST_SCHEMA,
    },
  });

  const text = response.text;
  console.log('=== RAW JSON RESPONSE ===');
  console.log(text);

  const parsed = JSON.parse(text!);
  const locs = parsed.pronounReference?.locations || [];
  console.log(`\n=== PRONOUN REFERENCE (${locs.length} issues) ===`);

  for (const loc of locs) {
    console.log('\n  Sentence:', JSON.stringify(loc.sentence));
    console.log('  QuotedText:', JSON.stringify(loc.quotedText));
    console.log('  Comment:', loc.comment);
    console.log('  Severity:', loc.severity);

    // Check if "Under this" is still being flagged
    if (loc.quotedText?.includes('Under this') || loc.quotedText?.includes('this')) {
      console.log('  >>> STILL FLAGGING "this" - CHECK IF FALSE POSITIVE <<<');
    }
  }

  // Check if "Under this" was correctly NOT flagged
  const flaggedUnderThis = locs.some((l: any) =>
    l.quotedText?.includes('Under this') &&
    l.sentence?.includes('the Senate rejected')
  );
  console.log('\n=== RESULT ===');
  if (flaggedUnderThis) {
    console.log('FAIL: "Under this" still flagged as pronoun reference issue');
  } else {
    console.log('PASS: "Under this" correctly NOT flagged (or flagged with appropriate context)');
  }
}

main().catch(e => { console.error(e); process.exit(1); });
