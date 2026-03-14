const VALID_WRITING_TYPES = [
  'argumentative', 'narrative', 'expository',
  'persuasive', 'analytical', 'informational',
] as const;

export function countWords(text: string): number {
  const trimmed = text.trim();
  if (trimmed.length === 0) return 0;
  return trimmed.split(/\s+/).length;
}

interface SubmitEssayInput {
  title: string;
  assignmentPrompt: string;
  writingType: string;
  content: string;
}

export function validateSubmitEssay(input: SubmitEssayInput): string | null {
  if (!input.title || input.title.trim().length === 0) return 'Title is required';
  if (input.title.length > 200) return 'Title must be 200 characters or fewer';
  if (!input.assignmentPrompt || input.assignmentPrompt.trim().length === 0) return 'Assignment prompt is required';
  if (input.assignmentPrompt.length > 2000) return 'Assignment prompt must be 2,000 characters or fewer';
  if (!VALID_WRITING_TYPES.includes(input.writingType as any)) return `Invalid writing type: ${input.writingType}`;
  if (!input.content || input.content.trim().length === 0) return 'Essay content is required';
  if (countWords(input.content) > 10000) return 'Essay content must be 10,000 words or fewer';
  return null;
}

interface ResubmitDraftInput {
  essayId: string;
  content: string;
}

export function validateResubmitDraft(input: ResubmitDraftInput): string | null {
  if (!input.essayId || input.essayId.trim().length === 0) return 'essayId is required';
  if (!input.content || input.content.trim().length === 0) return 'Essay content is required';
  if (countWords(input.content) > 10000) return 'Essay content must be 10,000 words or fewer';
  return null;
}
