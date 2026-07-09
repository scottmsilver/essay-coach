export function cohensKappa(a: string[], b: string[]): number {
  if (a.length !== b.length) {
    throw new Error(`cohensKappa: sequences must be the same length (got ${a.length} and ${b.length})`);
  }
  const n = a.length;
  if (n === 0) return 1;

  let agree = 0;
  const labels = new Set<string>();
  const countA: Record<string, number> = {};
  const countB: Record<string, number> = {};

  for (let i = 0; i < n; i++) {
    labels.add(a[i]);
    labels.add(b[i]);
    countA[a[i]] = (countA[a[i]] ?? 0) + 1;
    countB[b[i]] = (countB[b[i]] ?? 0) + 1;
    if (a[i] === b[i]) agree++;
  }

  const po = agree / n;
  let pe = 0;
  for (const label of labels) {
    pe += ((countA[label] ?? 0) / n) * ((countB[label] ?? 0) / n);
  }

  if (pe === 1) return 1;
  return (po - pe) / (1 - pe);
}

export interface GateThresholds {
  feedbackDeltaMax: number;
  challengerWinRateMin: number;
  reliabilityMin: number;
}

export const DEFAULT_GATE: GateThresholds = {
  feedbackDeltaMax: 0.5,
  challengerWinRateMin: 0.4,
  reliabilityMin: 0.8,
};

export function gateVerdict(
  input: { feedbackDelta: number; challengerWinRate: number; reliability: number },
  t: GateThresholds = DEFAULT_GATE
): { pass: boolean; reasons: string[] } {
  const reasons: string[] = [];

  if (input.feedbackDelta > t.feedbackDeltaMax) {
    reasons.push(
      `feedbackDelta ${input.feedbackDelta} exceeds max ${t.feedbackDeltaMax}`
    );
  }
  if (input.challengerWinRate < t.challengerWinRateMin) {
    reasons.push(
      `challengerWinRate ${input.challengerWinRate} is below min ${t.challengerWinRateMin}`
    );
  }
  if (input.reliability < t.reliabilityMin) {
    reasons.push(
      `reliability ${input.reliability} is below min ${t.reliabilityMin}`
    );
  }

  return { pass: reasons.length === 0, reasons };
}
