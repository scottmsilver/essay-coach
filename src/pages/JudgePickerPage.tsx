import { useCallback, useEffect, useRef, useState } from 'react';
import { Badge, Button, Text, TextInput } from '@mantine/core';

// ---------------------------------------------------------------------------
// Types — mirror eval/panel/picker-store.ts's GoldLabel and the routed-item
// shape used by eval/panel/panel-gate.ts, but kept local (no cross-import
// from the Node-only eval/ tree into the browser bundle).
// ---------------------------------------------------------------------------

type ReportKind = 'overall' | 'grammar' | 'transitions';

interface FeedbackSide {
  feedback: string;
}

interface RoutedItem {
  id: string;
  essay: string;
  incumbent: FeedbackSide;
  challenger: FeedbackSide;
}

interface RoutedItemsFile {
  report: ReportKind;
  items: RoutedItem[];
}

type DisplayWinner = 'A' | 'B' | 'tie';

/** Canonical frame: A = incumbent, B = challenger. Consumed by eval/panel/picker-store.ts readGold. */
interface GoldLabel {
  itemId: string;
  winner: DisplayWinner;
  note?: string;
  ts: string;
}

const VALID_REPORTS: ReportKind[] = ['overall', 'grammar', 'transitions'];

function validateRoutedFile(data: unknown): { file: RoutedItemsFile } | { error: string } {
  if (typeof data !== 'object' || data === null) {
    return { error: 'File does not contain a JSON object.' };
  }
  const obj = data as Record<string, unknown>;

  if (typeof obj.report !== 'string' || !VALID_REPORTS.includes(obj.report as ReportKind)) {
    return { error: `"report" must be one of ${VALID_REPORTS.join(', ')}.` };
  }

  if (!Array.isArray(obj.items) || obj.items.length === 0) {
    return { error: '"items" must be a non-empty array.' };
  }

  for (let i = 0; i < obj.items.length; i++) {
    const item = obj.items[i] as Record<string, unknown>;
    if (typeof item !== 'object' || item === null) {
      return { error: `items[${i}] is not an object.` };
    }
    if (typeof item.id !== 'string' || item.id.length === 0) {
      return { error: `items[${i}].id must be a non-empty string.` };
    }
    if (typeof item.essay !== 'string') {
      return { error: `items[${i}].essay must be a string.` };
    }
    const incumbent = item.incumbent as Record<string, unknown> | undefined;
    if (!incumbent || typeof incumbent.feedback !== 'string') {
      return { error: `items[${i}].incumbent.feedback must be a string.` };
    }
    const challenger = item.challenger as Record<string, unknown> | undefined;
    if (!challenger || typeof challenger.feedback !== 'string') {
      return { error: `items[${i}].challenger.feedback must be a string.` };
    }
  }

  return { file: obj as unknown as RoutedItemsFile };
}

/** Maps a displayed pick (A/B/tie, in randomized on-screen order) back to the
 * canonical frame (A=incumbent, B=challenger). `swapped` means the on-screen
 * A/B was flipped relative to canonical for this item. */
function toCanonicalWinner(displayed: DisplayWinner, swapped: boolean): DisplayWinner {
  if (displayed === 'tie') return 'tie';
  if (!swapped) return displayed;
  return displayed === 'A' ? 'B' : 'A';
}

function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function JudgePickerPage() {
  const [routedFile, setRoutedFile] = useState<RoutedItemsFile | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [swapMap, setSwapMap] = useState<boolean[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<GoldLabel[]>([]);
  const [pendingWinner, setPendingWinner] = useState<DisplayWinner | null>(null);
  const [noteDraft, setNoteDraft] = useState('');
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = routedFile?.items ?? [];
  const currentItem = items[currentIndex];
  const currentSwapped = swapMap[currentIndex] ?? false;
  const finished = routedFile !== null && currentIndex >= items.length;

  const loadFromText = useCallback((text: string) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch (err) {
      setLoadError(`Not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
      return;
    }
    const result = validateRoutedFile(parsed);
    if ('error' in result) {
      setLoadError(result.error);
      return;
    }
    setLoadError(null);
    setRoutedFile(result.file);
    setSwapMap(result.file.items.map(() => Math.random() < 0.5));
    setCurrentIndex(0);
    setResults([]);
    setPendingWinner(null);
    setNoteDraft('');
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => loadFromText(String(reader.result ?? ''));
      reader.onerror = () => setLoadError('Failed to read file.');
      reader.readAsText(file);
    },
    [loadFromText]
  );

  const commit = useCallback(
    (displayed: DisplayWinner) => {
      if (!currentItem) return;
      const winner = toCanonicalWinner(displayed, currentSwapped);
      const label: GoldLabel = {
        itemId: currentItem.id,
        winner,
        ...(noteDraft.trim() ? { note: noteDraft.trim() } : {}),
        ts: new Date().toISOString(),
      };
      setResults((prev) => [...prev, label]);
      setPendingWinner(null);
      setNoteDraft('');
      setCurrentIndex((i) => i + 1);
    },
    [currentItem, currentSwapped, noteDraft]
  );

  // Keyboard shortcuts: a/b/t select a pick, Enter confirms + advances.
  // Ignored while the note input holds focus for letter keys so typing a
  // note doesn't get hijacked; the note input handles its own Enter.
  useEffect(() => {
    if (!currentItem) return;
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const typing = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement;
      const key = e.key.toLowerCase();
      if (!typing && key === 'a') {
        e.preventDefault();
        setPendingWinner('A');
      } else if (!typing && key === 'b') {
        e.preventDefault();
        setPendingWinner('B');
      } else if (!typing && key === 't') {
        e.preventDefault();
        setPendingWinner('tie');
      } else if (key === 'enter' && !typing) {
        e.preventDefault();
        setPendingWinner((current) => {
          if (current) commit(current);
          return current;
        });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [currentItem, commit]);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const reset = () => {
    setRoutedFile(null);
    setLoadError(null);
    setSwapMap([]);
    setCurrentIndex(0);
    setResults([]);
    setPendingWinner(null);
    setNoteDraft('');
  };

  // -------------------------------------------------------------------------
  // Empty state — no file loaded yet.
  // -------------------------------------------------------------------------
  if (!routedFile) {
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <h2>Judge Picker</h2>
        <Text c="dimmed" style={{ marginBottom: 24 }}>
          Load a routed-items JSON file to blind-compare two feedback sets per essay and record gold labels for
          judge calibration.
        </Text>
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          style={{
            border: `2px dashed ${dragActive ? 'var(--color-primary)' : 'var(--color-border)'}`,
            borderRadius: 10,
            background: dragActive ? 'var(--color-primary-light)' : 'var(--color-surface)',
            padding: '48px 24px',
            textAlign: 'center',
          }}
        >
          <Text style={{ marginBottom: 16 }}>Drag a routed-items JSON file here, or</Text>
          <Button onClick={() => fileInputRef.current?.click()}>Choose file</Button>
          <input
            ref={fileInputRef}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleFile(file);
              e.target.value = '';
            }}
          />
        </div>
        {loadError && (
          <div className="error-state" style={{ marginTop: 16 }}>
            {loadError}
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Finished state — all items reviewed.
  // -------------------------------------------------------------------------
  if (finished) {
    const aWins = results.filter((r) => r.winner === 'A').length;
    const bWins = results.filter((r) => r.winner === 'B').length;
    const ties = results.filter((r) => r.winner === 'tie').length;
    return (
      <div style={{ maxWidth: 680, margin: '0 auto' }}>
        <h2>Judge Picker — Done</h2>
        <Text style={{ marginBottom: 16 }}>
          Reviewed {results.length} of {items.length} items for the <strong>{routedFile.report}</strong> report.
        </Text>
        <div
          style={{
            background: 'var(--color-surface)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 24,
            marginBottom: 24,
          }}
        >
          <Text style={{ marginBottom: 8 }}>Incumbent (A) wins: {aWins}</Text>
          <Text style={{ marginBottom: 8 }}>Challenger (B) wins: {bWins}</Text>
          <Text>Ties: {ties}</Text>
        </div>
        <Button onClick={() => downloadJson('gold-labels.json', results)} style={{ marginRight: 12 }}>
          Download gold labels
        </Button>
        <Button variant="default" onClick={reset}>
          Load another file
        </Button>
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Review state — one item at a time.
  // -------------------------------------------------------------------------
  const displayFeedbackA = currentSwapped ? currentItem.challenger.feedback : currentItem.incumbent.feedback;
  const displayFeedbackB = currentSwapped ? currentItem.incumbent.feedback : currentItem.challenger.feedback;

  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2>Judge Picker</h2>
        <Badge variant="light" color="blue">
          {routedFile.report}
        </Badge>
      </div>
      <Text c="dimmed" style={{ marginBottom: 20 }}>
        Item {currentIndex + 1} of {items.length}
      </Text>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, alignItems: 'start' }}>
        <div
          className="essay-text"
          style={{
            background: 'var(--color-surface-warm)',
            border: '1px solid var(--color-border)',
            borderRadius: 10,
            padding: 24,
            maxHeight: 480,
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}
        >
          {currentItem.essay}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {(
            [
              ['A', displayFeedbackA],
              ['B', displayFeedbackB],
            ] as const
          ).map(([label, feedback]) => (
            <div
              key={label}
              style={{
                background: 'var(--color-surface)',
                border:
                  pendingWinner === label ? '1px solid var(--color-primary)' : '1px solid var(--color-border)',
                borderRadius: 10,
                padding: 16,
                maxHeight: 220,
                overflowY: 'auto',
              }}
            >
              <Text fw={700} style={{ fontFamily: 'var(--font-ui)', marginBottom: 8 }}>
                {label}
              </Text>
              <Text style={{ whiteSpace: 'pre-wrap' }}>{feedback}</Text>
            </div>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 24, display: 'flex', gap: 12, alignItems: 'center' }}>
        <Button
          variant={pendingWinner === 'A' ? 'filled' : 'default'}
          onClick={() => commit('A')}
        >
          A is better
        </Button>
        <Button
          variant={pendingWinner === 'tie' ? 'filled' : 'default'}
          onClick={() => commit('tie')}
        >
          Tie
        </Button>
        <Button
          variant={pendingWinner === 'B' ? 'filled' : 'default'}
          onClick={() => commit('B')}
        >
          B is better
        </Button>
        <TextInput
          placeholder="Optional note..."
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.currentTarget.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              e.stopPropagation();
              if (pendingWinner) commit(pendingWinner);
            }
          }}
          style={{ flex: 1 }}
        />
      </div>
      <Text size="xs" c="dimmed" style={{ marginTop: 8 }}>
        Shortcuts: A / B / T to pick, Enter to confirm and advance.
      </Text>
    </div>
  );
}
