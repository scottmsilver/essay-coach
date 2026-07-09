import { useCallback, useEffect, useState } from 'react';
import { Button, Text, TextInput } from '@mantine/core';

type DisplayWinner = 'A' | 'B' | 'tie';

export interface EvalComparePickerProps {
  essay: string;
  feedbackA: string;
  feedbackB: string;
  onPick: (winner: 'A' | 'B' | 'tie', note?: string) => void;
  index: number;
  total: number;
}

/** Maps a displayed pick (A/B/tie, in randomized on-screen order) back to the
 * canonical frame (A=incumbent, B=challenger). `swapped` means the on-screen
 * A/B was flipped relative to canonical for this item. */
function toCanonicalWinner(displayed: DisplayWinner, swapped: boolean): DisplayWinner {
  if (displayed === 'tie') return 'tie';
  if (!swapped) return displayed;
  return displayed === 'A' ? 'B' : 'A';
}

/**
 * Blind compare/pick UI for a single essay + two feedback sets.
 *
 * Re-randomization: the on-screen A/B swap is initialized once per mount via
 * lazy useState. The parent is responsible for keying this component by the
 * item's stable id (e.g. `<EvalComparePicker key={item.id} .../>`) so that
 * advancing to the next item remounts the component and draws a fresh swap,
 * rather than reusing stale swap/pending/note state from the previous item.
 */
export default function EvalComparePicker({
  essay,
  feedbackA,
  feedbackB,
  onPick,
  index,
  total,
}: EvalComparePickerProps) {
  const [swapped] = useState(() => Math.random() < 0.5);
  const [pendingWinner, setPendingWinner] = useState<DisplayWinner | null>(null);
  const [noteDraft, setNoteDraft] = useState('');

  const commit = useCallback(
    (displayed: DisplayWinner) => {
      const winner = toCanonicalWinner(displayed, swapped);
      onPick(winner, noteDraft.trim() ? noteDraft.trim() : undefined);
      setPendingWinner(null);
      setNoteDraft('');
    },
    [swapped, noteDraft, onPick]
  );

  // Keyboard shortcuts: a/b/t select a pick, Enter confirms + advances.
  // Ignored while the note input holds focus for letter keys so typing a
  // note doesn't get hijacked; the note input handles its own Enter.
  useEffect(() => {
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
  }, [commit]);

  const displayFeedbackA = swapped ? feedbackB : feedbackA;
  const displayFeedbackB = swapped ? feedbackA : feedbackB;

  return (
    <>
      <Text c="dimmed" style={{ marginBottom: 20 }}>
        Item {index + 1} of {total}
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
          {essay}
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
    </>
  );
}
