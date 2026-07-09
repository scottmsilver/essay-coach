import { useCallback, useRef, useState } from 'react';
import { Badge, Button, Text } from '@mantine/core';
import EvalComparePicker from '../components/EvalComparePicker';

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
  const [currentIndex, setCurrentIndex] = useState(0);
  const [results, setResults] = useState<GoldLabel[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const items = routedFile?.items ?? [];
  const currentItem = items[currentIndex];
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
    setCurrentIndex(0);
    setResults([]);
  }, []);

  const handleFile = useCallback(
    (file: File) => {
      const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB
      if (file.size > MAX_FILE_BYTES) {
        setLoadError(
          `File is too large (${(file.size / (1024 * 1024)).toFixed(1)} MB). Max size is 10 MB.`
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => loadFromText(String(reader.result ?? ''));
      reader.onerror = () => setLoadError('Failed to read file.');
      reader.readAsText(file);
    },
    [loadFromText]
  );

  const handlePick = useCallback(
    (winner: DisplayWinner, note?: string) => {
      if (!currentItem) return;
      const label: GoldLabel = {
        itemId: currentItem.id,
        winner,
        ...(note ? { note } : {}),
        ts: new Date().toISOString(),
      };
      setResults((prev) => [...prev, label]);
      setCurrentIndex((i) => i + 1);
    },
    [currentItem]
  );

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const reset = () => {
    setRoutedFile(null);
    setLoadError(null);
    setCurrentIndex(0);
    setResults([]);
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
  // Review state — one item at a time. EvalComparePicker owns the blind
  // swap/labels, canonical remap, keyboard shortcuts, note field, and
  // progress display; it's keyed by item id so advancing to the next item
  // remounts it (fresh swap + cleared pending pick/note draft).
  // -------------------------------------------------------------------------
  return (
    <div style={{ maxWidth: 1120, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <h2>Judge Picker</h2>
        <Badge variant="light" color="blue">
          {routedFile.report}
        </Badge>
      </div>
      <EvalComparePicker
        key={currentItem.id}
        essay={currentItem.essay}
        feedbackA={currentItem.incumbent.feedback}
        feedbackB={currentItem.challenger.feedback}
        onPick={handlePick}
        index={currentIndex}
        total={items.length}
      />
    </div>
  );
}
