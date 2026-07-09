export interface Edit {
  start: number;
  end: number;
  replacement: string;
}

/**
 * Compute F-beta score: (1+b²)·p·r / (b²·p + r)
 * Returns 0 when denominator is 0.
 */
export function fBeta(precision: number, recall: number, beta: number): number {
  const betaSq = beta * beta;
  const numerator = (1 + betaSq) * precision * recall;
  const denominator = betaSq * precision + recall;

  // Return 0 when denominator is 0
  if (denominator === 0) {
    return 0;
  }

  return numerator / denominator;
}

/**
 * Score system edits against gold edits.
 * A true positive is an exact match on start, end, and replacement.
 *
 * Empty-set convention:
 * - If both system and gold are empty: precision=1, recall=1, f05=1
 * - If system is empty but gold is not: precision=0, recall=0
 * - If gold is empty but system is not: precision=0 (false positives), recall=1 (no false negatives)
 * - If gold is empty and system is empty: precision=1, recall=1
 */
export function scoreEdits(
  system: Edit[],
  gold: Edit[]
): { precision: number; recall: number; f05: number } {
  // Count true positives: system edits that match a gold edit
  let tp = 0;
  for (const sEdit of system) {
    for (const gEdit of gold) {
      if (
        sEdit.start === gEdit.start &&
        sEdit.end === gEdit.end &&
        sEdit.replacement === gEdit.replacement
      ) {
        tp++;
        break; // Don't double-count
      }
    }
  }

  // Calculate precision
  let precision: number;
  if (system.length === 0) {
    // If system is empty, precision is 1 if gold is also empty, else 0
    precision = gold.length === 0 ? 1 : 0;
  } else {
    precision = tp / system.length;
  }

  // Calculate recall
  let recall: number;
  if (gold.length === 0) {
    // If gold is empty, recall is 1 (no false negatives possible)
    recall = 1;
  } else {
    recall = tp / gold.length;
  }

  // Calculate f0.5
  const f05 = fBeta(precision, recall, 0.5);

  return { precision, recall, f05 };
}
