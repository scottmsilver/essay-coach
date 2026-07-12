import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { collection, query, orderBy, onSnapshot, Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import {
  Autocomplete,
  Badge,
  Button,
  MultiSelect,
  Select,
  Stack,
  Text,
  TextInput,
  Textarea,
} from '@mantine/core';
import { showError } from '../utils/dialogs';
import { db, functions } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useEssays } from '../hooks/useEssays';
import { REPORT_LABELS } from '../types';

// Report kinds the eval panel supports (functions/src/shared/panel/types.ts's
// ReportKind — kept local since that module lives in the Node-only
// functions/eval tree, same convention as JudgePickerPage.tsx).
type ReportKind = 'overall' | 'grammar' | 'transitions';
const EVAL_REPORTS: ReportKind[] = ['overall', 'grammar', 'transitions'];

type RunStatus = 'generating' | 'judging' | 'complete' | 'error';

interface EvalRunSummary {
  id: string;
  report: ReportKind;
  essayIds: string[];
  status: RunStatus;
  progress?: { done: number; total: number; message: string };
  verdict?: { pass: boolean; reasons: string[] };
  // Persisted by startEvalRun under config (functions/src/evalRun.ts's
  // runRef.set() call) — each may be '' when the run was started without it.
  challengerLabel?: string;
  challengerModelOverride?: string;
  createdAt?: Date;
  createdBy?: string;
  errorMessage?: string;
}

const MAX_ESSAYS = 20;

// Mirrors CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH in functions/src/evalRun.ts's
// validateEvalInput — the server is the actual enforcement point; this is
// just a client-side heads-up so the user doesn't type 20k+ chars only to
// have startEvalRun reject the whole call.
const CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH = 20000;

// Mirrors CHALLENGER_MODEL_OVERRIDE_SHAPE in functions/src/evalRun.ts's
// validateEvalInput — same client-side-heads-up rationale as the prompt
// length cap above; the server is the real enforcement point. Matches
// either a bare Gemini model id (e.g. `gemini-3.5-flash`) or an
// `openrouter/vendor/model` id (up to 3 total '/'-separated segments).
const CHALLENGER_MODEL_OVERRIDE_SHAPE = /^[a-zA-Z0-9._:-]+(\/[a-zA-Z0-9._:-]+){0,2}$/;
const CHALLENGER_MODEL_OVERRIDE_MAX_LENGTH = 120;

function parseRun(doc: any): EvalRunSummary {
  const data = doc.data();
  return {
    id: doc.id,
    report: data.report,
    essayIds: data.essayIds ?? [],
    status: data.status,
    progress: data.progress,
    verdict: data.verdict,
    challengerLabel: data.config?.challengerLabel,
    challengerModelOverride: data.config?.challengerModelOverride,
    createdAt: data.createdAt instanceof Timestamp ? data.createdAt.toDate() : undefined,
    createdBy: data.createdBy,
    errorMessage: data.errorMessage,
  };
}

function formatRelativeTime(date: Date): string {
  const diffMs = date.getTime() - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ['year', 60 * 60 * 24 * 365],
    ['month', 60 * 60 * 24 * 30],
    ['day', 60 * 60 * 24],
    ['hour', 60 * 60],
    ['minute', 60],
    ['second', 1],
  ];
  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(diffSec) >= secondsInUnit || unit === 'second') {
      return rtf.format(Math.round(diffSec / secondsInUnit), unit);
    }
  }
  return rtf.format(0, 'second');
}

function StatusChip({ run }: { run: EvalRunSummary }) {
  if (run.status === 'complete' && run.verdict) {
    return (
      <Badge color={run.verdict.pass ? 'green' : 'red'} variant="light">
        {run.verdict.pass ? 'PASS' : 'FAIL'}
      </Badge>
    );
  }
  if (run.status === 'error') {
    return (
      <Badge color="red" variant="filled">
        error
      </Badge>
    );
  }
  if (run.status === 'generating' || run.status === 'judging') {
    const done = run.progress?.done ?? 0;
    const total = run.progress?.total ?? run.essayIds.length;
    return (
      <Badge color="blue" variant="light">
        {run.status} {done}/{total}
      </Badge>
    );
  }
  return (
    <Badge color="gray" variant="light">
      {run.status}
    </Badge>
  );
}

export default function EvalRunsPage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { essays } = useEssays();

  const [runs, setRuns] = useState<EvalRunSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  const [report, setReport] = useState<ReportKind>('overall');
  const [essayIds, setEssayIds] = useState<string[]>([]);
  const [challengerLabel, setChallengerLabel] = useState('');
  const [challengerPrompt, setChallengerPrompt] = useState('');
  const [challengerModel, setChallengerModel] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Populated once (best-effort) from listEvalModels — the Challenger model
  // field stays a free-typed Autocomplete even if this never resolves, so a
  // failure here must never block or error out the form (see the catch
  // below: silent fallback to empty suggestions, no error toast).
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const listEvalModels = httpsCallable<Record<string, never>, { models: string[] }>(functions, 'listEvalModels');
    listEvalModels({})
      .then((result) => {
        if (!cancelled) setModelOptions(result.data.models);
      })
      .catch((error) => {
        // Convenience-only feature — fall back to free text, no user-facing error.
        console.error('Failed to load eval models:', error);
      })
      .finally(() => {
        if (!cancelled) setModelsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const modelOverrideValid =
    challengerModel.trim().length === 0 ||
    (challengerModel.trim().length <= CHALLENGER_MODEL_OVERRIDE_MAX_LENGTH &&
      CHALLENGER_MODEL_OVERRIDE_SHAPE.test(challengerModel.trim()));

  useEffect(() => {
    const q = query(collection(db, 'evalRuns'), orderBy('createdAt', 'desc'));
    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        setRuns(snapshot.docs.map(parseRun));
        setLoadError(false);
        setLoading(false);
      },
      (error) => {
        // Permission-denied must not masquerade as "no runs yet".
        console.error('Failed to load eval runs:', error);
        setLoadError(true);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  // startEvalRun looks essays up under the caller's own uid
  // (users/{uid}/essays/{essayId}) — only the current user's own essays are
  // eligible, shared-with-me essays would 404 server-side.
  const ownEssayOptions = useMemo(
    () =>
      essays
        .filter((e) => e.ownerUid === user?.uid)
        .map((e) => ({ value: e.id, label: e.title })),
    [essays, user?.uid]
  );

  const estimatedCalls = essayIds.length * 12 + essayIds.length * 2;

  const canSubmit =
    essayIds.length > 0 &&
    essayIds.length <= MAX_ESSAYS &&
    (challengerPrompt.trim().length > 0 || challengerModel.trim().length > 0) &&
    modelOverrideValid &&
    !submitting;

  async function handleRun() {
    setSubmitting(true);
    try {
      const startEvalRun = httpsCallable<
        {
          report: ReportKind;
          essayIds: string[];
          challengerLabel?: string;
          challengerPromptOverride: string;
          challengerModelOverride?: string;
        },
        { runId: string }
      >(functions, 'startEvalRun');
      const trimmedModel = challengerModel.trim();
      const result = await startEvalRun({
        report,
        essayIds,
        challengerLabel: challengerLabel.trim() || undefined,
        challengerPromptOverride: challengerPrompt,
        // httpsCallable serializes `undefined` object values to null, which
        // the server's "must be a string if provided" validation rejects —
        // omit the key entirely when there's no model override (same
        // pattern as handlePick's `note` field in EvalRunDetailPage.tsx).
        ...(trimmedModel ? { challengerModelOverride: trimmedModel } : {}),
      });
      navigate(`/admin/eval/${result.data.runId}`);
    } catch (error) {
      showError({
        title: 'Could not start eval run',
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <h2 style={{ marginBottom: 20 }}>Eval Runs</h2>

      <Stack gap="md" style={{ marginBottom: 40 }}>
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 24,
          }}
        >
          <Text fw={700} style={{ fontFamily: 'var(--font-ui)', marginBottom: 16 }}>
            New Run
          </Text>
          <Stack gap="sm">
            <Select
              label="Report"
              data={EVAL_REPORTS.map((r) => ({ value: r, label: REPORT_LABELS[r] }))}
              value={report}
              onChange={(value) => value && setReport(value as ReportKind)}
              allowDeselect={false}
            />
            <MultiSelect
              label="Essays"
              placeholder="Choose up to 20 essays"
              data={ownEssayOptions}
              value={essayIds}
              onChange={setEssayIds}
              maxValues={MAX_ESSAYS}
              searchable
              clearable
            />
            <Text size="xs" c="dimmed">
              {essayIds.length} / {MAX_ESSAYS} essays selected
            </Text>
            <TextInput
              label="Challenger label"
              placeholder="e.g. tighter-grammar-v2"
              value={challengerLabel}
              onChange={(e) => setChallengerLabel(e.currentTarget.value)}
            />
            <Textarea
              label="Challenger prompt override"
              description={`Optional — leave empty to keep the production prompt and compare models only. Do not import the server prompt constants into the client — paste the text here. Max ${CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH.toLocaleString()} characters.`}
              placeholder="Paste the full challenger system prompt..."
              value={challengerPrompt}
              onChange={(e) => setChallengerPrompt(e.currentTarget.value)}
              maxLength={CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH}
              autosize
              minRows={6}
            />
            <Text size="xs" c="dimmed">
              {challengerPrompt.length.toLocaleString()} / {CHALLENGER_PROMPT_OVERRIDE_MAX_LENGTH.toLocaleString()} characters
            </Text>
            <Autocomplete
              label="Challenger model"
              description="Optional — leave empty to keep the production model and compare prompts only. gemini-* runs natively; openrouter/vendor/model runs via OpenRouter."
              placeholder={
                modelsLoading
                  ? 'Loading models…'
                  : 'e.g. gemini-3.5-flash or openrouter/anthropic/claude-3-opus — leave empty to keep the production model'
              }
              data={modelOptions}
              limit={20}
              value={challengerModel}
              onChange={setChallengerModel}
              error={
                !modelOverrideValid
                  ? 'Only letters, numbers, \'.\', \'_\', \':\', \'-\', up to 3 \'/\'-separated segments — up to 120 characters.'
                  : undefined
              }
            />
            <Text size="sm" c="dimmed">
              Estimated calls: {essayIds.length} essay(s) × 12 judge calls + {essayIds.length} essay(s) × 2
              generations ≈ <strong>{estimatedCalls}</strong> calls
            </Text>
            <div>
              <Button onClick={handleRun} disabled={!canSubmit} loading={submitting}>
                Run
              </Button>
            </div>
          </Stack>
        </div>
      </Stack>

      {loading ? (
        <div className="loading-state">
          <div className="spinner" />
          <p>Loading eval runs...</p>
        </div>
      ) : loadError ? (
        <Text c="red">
          Couldn't load eval runs — you may not have eval admin access.
        </Text>
      ) : runs.length === 0 ? (
        <Text c="dimmed">No eval runs yet. Start one above.</Text>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {runs.map((run) => (
            <div
              key={run.id}
              onClick={() => navigate(`/admin/eval/${run.id}`)}
              style={{
                background: 'var(--color-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 10,
                padding: 16,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 16,
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <StatusChip run={run} />
                <div>
                  <Text fw={700} style={{ fontFamily: 'var(--font-ui)' }}>
                    {REPORT_LABELS[run.report] ?? run.report} · {run.challengerLabel || '—'}
                    {run.challengerModelOverride ? ` · model: ${run.challengerModelOverride}` : ''}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {run.essayIds.length} essay{run.essayIds.length === 1 ? '' : 's'}
                  </Text>
                </div>
              </div>
              <Text size="xs" c="dimmed">
                {run.createdAt ? formatRelativeTime(run.createdAt) : ''}
              </Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
