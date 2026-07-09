import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { collection, doc, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { Badge, Progress, Table, Text } from '@mantine/core';
import { notifications } from '@mantine/notifications';
import { db, functions } from '../firebase';
import EvalComparePicker from '../components/EvalComparePicker';
import { DEFAULT_GATE } from '../../shared/panel/metrics';

type ReportKind = 'overall' | 'grammar' | 'transitions';
type RunStatus = 'generating' | 'judging' | 'complete' | 'error';
type PairwiseWinner = 'A' | 'B' | 'tie';

interface GoldLabel {
  winner: PairwiseWinner;
  note?: string;
  ts: string;
  by: string;
}

interface EvalRunVerdict {
  pass: boolean;
  reasons: string[];
  // Optional: older run docs (written before these fields were persisted)
  // won't have them, so render code must fall back to '—'.
  feedbackDelta?: number;
  challengerWinRate?: number;
  reliability?: number;
}

interface EvalRunDoc {
  report: ReportKind;
  essayIds: string[];
  status: RunStatus;
  progress?: { done: number; total: number; message: string };
  verdict?: EvalRunVerdict;
  failedJudges?: string[];
  routedCount?: number;
  errorMessage?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

interface EvalItem {
  id: string;
  essayId: string;
  essayExcerpt: string;
  incumbentFeedback: string;
  challengerFeedback: string;
  weightedMean: { A: number; B: number };
  majorityWinner: PairwiseWinner;
  positionBiasFlag: boolean;
  disagreement: boolean;
  failedJudges?: string[];
  routed: boolean;
  goldLabel?: GoldLabel;
}

// Status is considered stalled if it's still running and the run doc hasn't
// been updated in this long. Recomputed on an interval (not just on
// snapshot) so the banner appears even if no new Firestore write arrives.
const STALLED_MS = 3 * 60 * 1000;

function toDate(value: unknown): Date | undefined {
  return value instanceof Timestamp ? value.toDate() : undefined;
}

function parseRun(snapshot: any): EvalRunDoc {
  const data = snapshot.data() ?? {};
  return {
    report: data.report,
    essayIds: data.essayIds ?? [],
    status: data.status,
    progress: data.progress,
    verdict: data.verdict,
    failedJudges: data.failedJudges,
    routedCount: data.routedCount,
    errorMessage: data.errorMessage,
    createdAt: toDate(data.createdAt),
    updatedAt: toDate(data.updatedAt),
  };
}

function parseItem(snapshot: any): EvalItem {
  const data = snapshot.data() ?? {};
  return {
    id: snapshot.id,
    essayId: data.essayId,
    essayExcerpt: data.essayExcerpt ?? '',
    incumbentFeedback: data.incumbentFeedback ?? '',
    challengerFeedback: data.challengerFeedback ?? '',
    weightedMean: data.weightedMean ?? { A: 0, B: 0 },
    majorityWinner: data.majorityWinner,
    positionBiasFlag: !!data.positionBiasFlag,
    disagreement: !!data.disagreement,
    failedJudges: data.failedJudges,
    routed: !!data.routed,
    goldLabel: data.goldLabel,
  };
}

function truncate(text: string, max = 90): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

interface MetricRowSpec {
  label: string;
  value: number | undefined;
  format: (v: number) => string;
  thresholdLabel: string;
  passes: (v: number) => boolean;
}

/** One row of the verdict card's metric breakdown: label, actual value vs.
 * its threshold, and a green/red dot reflecting that metric's own pass
 * state (independent of the overall verdict.pass). Falls back to '—' when
 * the value is absent, e.g. on older run docs written before these fields
 * were persisted. */
function MetricRow({ label, value, format, thresholdLabel, passes }: MetricRowSpec) {
  const known = typeof value === 'number';
  const ok = known && passes(value);
  const dotColor = known ? (ok ? 'var(--color-green)' : 'var(--color-red)') : 'var(--color-border)';
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '4px 0' }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          background: dotColor,
          flexShrink: 0,
        }}
      />
      <Text size="sm" style={{ fontFamily: 'var(--font-ui)', minWidth: 140 }}>
        {label}
      </Text>
      <Text
        size="sm"
        fw={600}
        style={{
          fontFamily: 'var(--font-ui)',
          fontVariantNumeric: 'tabular-nums',
          color: known ? (ok ? 'var(--color-green)' : 'var(--color-red)') : undefined,
        }}
        c={known ? undefined : 'dimmed'}
      >
        {known ? format(value) : '—'}
      </Text>
      <Text size="xs" c="dimmed">
        {thresholdLabel}
      </Text>
    </div>
  );
}

export default function EvalRunDetailPage() {
  const { runId } = useParams<{ runId: string }>();
  const [run, setRun] = useState<EvalRunDoc | null>(null);
  const [items, setItems] = useState<EvalItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!runId) return;
    const unsubscribe = onSnapshot(
      doc(db, 'evalRuns', runId),
      (snapshot) => {
        setRun(snapshot.exists() ? parseRun(snapshot) : null);
        setLoading(false);
      },
      () => setLoading(false)
    );
    return unsubscribe;
  }, [runId]);

  useEffect(() => {
    if (!runId) return;
    const unsubscribe = onSnapshot(collection(db, 'evalRuns', runId, 'items'), (snapshot) => {
      setItems(snapshot.docs.map(parseItem));
    });
    return unsubscribe;
  }, [runId]);

  // Recompute "stalled" on a timer, not just on snapshot updates, so the
  // banner shows up even if the run doc stops receiving writes entirely.
  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(interval);
  }, []);

  const isRunning = run?.status === 'generating' || run?.status === 'judging';
  const stalled = isRunning && !!run?.updatedAt && now - run.updatedAt.getTime() > STALLED_MS;

  const routedUnlabeled = useMemo(() => items.filter((i) => i.routed && !i.goldLabel), [items]);
  const nextToLabel = routedUnlabeled[0];

  async function handlePick(item: EvalItem, winner: PairwiseWinner, note?: string) {
    if (!runId) return;
    try {
      const recordGoldLabel = httpsCallable<
        { runId: string; itemId: string; winner: PairwiseWinner; note?: string },
        { ok: boolean }
      >(functions, 'recordGoldLabel');
      await recordGoldLabel({ runId, itemId: item.essayId, winner, note });
      notifications.show({
        color: 'green',
        title: 'Gold label recorded',
        message: `Recorded "${winner}" for this item.`,
        autoClose: 4000,
      });
    } catch (error) {
      notifications.show({
        color: 'red',
        title: 'Could not record gold label',
        message: error instanceof Error ? error.message : String(error),
        autoClose: 6000,
      });
    }
  }

  if (loading) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p>Loading eval run...</p>
      </div>
    );
  }

  if (!run) {
    return <Text c="dimmed">Eval run not found.</Text>;
  }

  const done = run.progress?.done ?? 0;
  const total = run.progress?.total ?? run.essayIds.length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 20 }}>
        <h2>Eval Run</h2>
        <Badge
          color={run.status === 'complete' ? (run.verdict?.pass ? 'green' : 'red') : run.status === 'error' ? 'red' : 'blue'}
          variant={run.status === 'error' ? 'filled' : 'light'}
        >
          {run.status === 'complete' ? (run.verdict?.pass ? 'PASS' : 'FAIL') : run.status}
        </Badge>
      </div>

      {stalled && (
        <div
          style={{
            background: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid var(--color-yellow)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            color: 'var(--color-yellow)',
          }}
        >
          This run looks stalled — no progress update in over 3 minutes. It may have crashed; check the function
          logs.
        </div>
      )}

      {isRunning && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <Progress value={pct} striped animated style={{ marginBottom: 12 }} />
          <Text size="sm" c="dimmed">
            {run.progress?.message ?? `Evaluated ${done} of ${total}`}
          </Text>
        </div>
      )}

      {run.status === 'error' && run.errorMessage && (
        <div
          style={{
            background: 'var(--color-red-light)',
            border: '1px solid var(--color-red)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            color: 'var(--color-red)',
          }}
        >
          {run.errorMessage}
        </div>
      )}

      {run.failedJudges && run.failedJudges.length > 0 && (
        <div
          style={{
            background: 'rgba(217, 119, 6, 0.08)',
            border: '1px solid var(--color-yellow)',
            borderRadius: 10,
            padding: 16,
            marginBottom: 16,
            color: 'var(--color-yellow)',
          }}
        >
          Some judges failed and were excluded from the panel: {run.failedJudges.join(', ')}
        </div>
      )}

      {run.status === 'complete' && run.verdict && (
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
            <Badge size="lg" color={run.verdict.pass ? 'green' : 'red'}>
              {run.verdict.pass ? 'PASS' : 'FAIL'}
            </Badge>
            <Text fw={700} style={{ fontFamily: 'var(--font-ui)' }}>
              Gate verdict
            </Text>
          </div>
          <div style={{ marginBottom: 12 }}>
            <MetricRow
              label="Feedback delta"
              value={run.verdict.feedbackDelta}
              format={(v) => v.toFixed(2)}
              thresholdLabel={`≤ ${DEFAULT_GATE.feedbackDeltaMax}`}
              passes={(v) => v <= DEFAULT_GATE.feedbackDeltaMax}
            />
            <MetricRow
              label="Challenger win rate"
              value={run.verdict.challengerWinRate}
              format={(v) => `${Math.round(v * 100)}%`}
              thresholdLabel={`≥ ${Math.round(DEFAULT_GATE.challengerWinRateMin * 100)}%`}
              passes={(v) => v >= DEFAULT_GATE.challengerWinRateMin}
            />
            <MetricRow
              label="Reliability"
              value={run.verdict.reliability}
              format={(v) => `${Math.round(v * 100)}%`}
              thresholdLabel={`≥ ${Math.round(DEFAULT_GATE.reliabilityMin * 100)}%`}
              passes={(v) => v >= DEFAULT_GATE.reliabilityMin}
            />
          </div>
          {run.verdict.reasons.length > 0 ? (
            <ul style={{ margin: 0, paddingLeft: 20 }}>
              {run.verdict.reasons.map((reason, i) => (
                <li key={i}>
                  <Text size="sm" c="var(--color-red)">
                    {reason}
                  </Text>
                </li>
              ))}
            </ul>
          ) : (
            <Text size="sm" c="dimmed">
              All gate metrics were within thresholds.
            </Text>
          )}
          {typeof run.routedCount === 'number' && (
            <Text size="sm" c="dimmed" style={{ marginTop: 8 }}>
              {run.routedCount} item{run.routedCount === 1 ? '' : 's'} routed for human review.
            </Text>
          )}
        </div>
      )}

      {nextToLabel && (
        <div
          style={{
            background: 'var(--color-surface-warm)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <Text fw={700} style={{ fontFamily: 'var(--font-ui)', marginBottom: 4 }}>
            Gold label needed
          </Text>
          <Text size="sm" c="dimmed" style={{ marginBottom: 16 }}>
            {routedUnlabeled.length} routed item{routedUnlabeled.length === 1 ? '' : 's'} awaiting a gold label.
          </Text>
          <EvalComparePicker
            key={nextToLabel.essayId}
            essay={nextToLabel.essayExcerpt}
            feedbackA={nextToLabel.incumbentFeedback}
            feedbackB={nextToLabel.challengerFeedback}
            onPick={(winner, note) => handlePick(nextToLabel, winner, note)}
            index={0}
            total={routedUnlabeled.length}
          />
        </div>
      )}

      <Text fw={700} style={{ fontFamily: 'var(--font-ui)', marginBottom: 12 }}>
        Items ({items.length})
      </Text>
      <div style={{ overflowX: 'auto' }}>
        <Table striped highlightOnHover verticalSpacing="sm">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>Essay</Table.Th>
              <Table.Th>Winner</Table.Th>
              <Table.Th>Mean A / B</Table.Th>
              <Table.Th>Flags</Table.Th>
              <Table.Th>Routed</Table.Th>
              <Table.Th>Gold label</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {items.map((item) => (
              <Table.Tr key={item.id}>
                <Table.Td>
                  <Text size="sm">{truncate(item.essayExcerpt)}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={item.majorityWinner === 'tie' ? 'gray' : 'blue'}>
                    {item.majorityWinner}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="sm" style={{ fontFamily: 'var(--font-ui)', fontVariantNumeric: 'tabular-nums' }}>
                    {item.weightedMean.A.toFixed(2)} / {item.weightedMean.B.toFixed(2)}
                  </Text>
                </Table.Td>
                <Table.Td>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {item.disagreement && (
                      <Badge size="xs" color="orange" variant="light">
                        disagreement
                      </Badge>
                    )}
                    {item.positionBiasFlag && (
                      <Badge size="xs" color="orange" variant="light">
                        position bias
                      </Badge>
                    )}
                  </div>
                </Table.Td>
                <Table.Td>{item.routed ? '●' : ''}</Table.Td>
                <Table.Td>
                  {item.goldLabel ? (
                    <Text size="sm">
                      {item.goldLabel.winner}
                      {item.goldLabel.note ? ` — ${item.goldLabel.note}` : ''}
                    </Text>
                  ) : (
                    <Text size="sm" c="dimmed">
                      —
                    </Text>
                  )}
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </div>
    </div>
  );
}
