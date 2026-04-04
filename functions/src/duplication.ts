import { streamGeminiJson } from './streamGemini';
import type { DocumentReference } from 'firebase-admin/firestore';

// ── Types (canonical definitions in shared/duplicationTypes.ts) ──────────
export type { DuplicationInstance, DuplicationFinding, DuplicationAnalysis } from '../../shared/duplicationTypes';
import type { DuplicationAnalysis } from '../../shared/duplicationTypes';

// ── System Prompt ────────────────────────────────────────────────────────

const DUPLICATION_SYSTEM_PROMPT = `You are a writing coach helping high school students eliminate repetition in their essays. Your job is to find places where the same idea, argument, or claim appears more than once and help the student decide which version to keep.

## What counts as duplication
- The same IDEA restated in different words (not the same exact phrase, but the same point)
- The same argument or claim made in multiple paragraphs
- The thesis previewing a conclusion that is then restated at the end
- A supporting point introduced in one paragraph and repeated without adding new information in another

## What does NOT count as duplication
- Intentional callbacks or references that build on earlier points with new analysis
- Topic sentences that introduce a paragraph's focus (even if related to the thesis)
- Transitions that briefly reference a previous point to connect to a new one
- Evidence or examples that support the same claim but add different details

## For each duplication found
1. Name the shared idea in a short phrase (e.g., "isolation leads to destruction")
2. Quote the EXACT text from each instance — do not paraphrase
3. Note which paragraph each instance appears in (1-indexed)
4. Recommend which instance to KEEP (the strongest, most developed version) and which to CUT
5. Write a Socratic coaching comment: ask the student what NEW insight they could add in the space freed by cutting the duplicate. Don't tell them what to write — make them think.

## Severity
- **high**: The same core argument appears 3+ times, or a major thesis point is repeated verbatim
- **medium**: An idea appears twice, or a supporting point is restated without adding new evidence

## Coaching tone
- Warm but direct. Name what's happening clearly.
- Always acknowledge that the repeated idea is GOOD — the problem is saying it twice, not the idea itself.
- Frame cutting as an opportunity: "What could you explore in this space instead?"
- Never rewrite for the student. Ask questions that make them think.

## Summary
- Count total duplications (number of findings, not instances)
- Count unique ideas in the essay that are NOT duplicated
- Write a brief overall comment about the essay's repetition patterns`;

// ── Gemini Response Schema ───────────────────────────────────────────────

const INSTANCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    quotedText: { type: 'string' as const },
    paragraph: { type: 'number' as const },
    recommendation: { type: 'string' as const, enum: ['keep', 'cut'] },
  },
  required: ['quotedText', 'paragraph', 'recommendation'],
};

const FINDING_SCHEMA = {
  type: 'object' as const,
  properties: {
    idea: { type: 'string' as const },
    severity: { type: 'string' as const, enum: ['high', 'medium'] },
    instances: { type: 'array' as const, items: INSTANCE_SCHEMA },
    comment: { type: 'string' as const },
  },
  required: ['idea', 'severity', 'instances', 'comment'],
};

const DUPLICATION_ANALYSIS_SCHEMA = {
  type: 'object' as const,
  properties: {
    findings: { type: 'array' as const, items: FINDING_SCHEMA },
    summary: {
      type: 'object' as const,
      properties: {
        totalDuplications: { type: 'number' as const },
        uniqueIdeas: { type: 'number' as const },
        overallComment: { type: 'string' as const },
      },
      required: ['totalDuplications', 'uniqueIdeas', 'overallComment'],
    },
  },
  required: ['findings', 'summary'],
};

// ── Analysis Function ────────────────────────────────────────────────────

export function buildDuplicationPrompt(content: string): string {
  return `Analyze this student essay for repeated ideas. Find places where the same argument, claim, or insight appears more than once.\n\n${content}`;
}

export async function analyzeDuplicationWithGemini(
  apiKey: string,
  content: string,
  progressRef?: DocumentReference,
): Promise<DuplicationAnalysis> {
  const json = await streamGeminiJson({
    apiKey,
    contents: buildDuplicationPrompt(content),
    systemInstruction: DUPLICATION_SYSTEM_PROMPT,
    responseSchema: DUPLICATION_ANALYSIS_SCHEMA,
    progressRef,
    statusField: 'duplicationStatus',
    generatingMessage: 'Finding repeated ideas...',
  });
  return JSON.parse(json) as DuplicationAnalysis;
}
