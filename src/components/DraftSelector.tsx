import type { Draft } from '../types';

interface Props { drafts: Draft[]; selectedDraftId: string; onChange: (id: string) => void; }

export default function DraftSelector({ drafts, selectedDraftId, onChange }: Props) {
  if (drafts.length <= 1) return null;
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={{ fontSize: 14, fontWeight: 500, marginRight: 8 }}>Draft:</label>
      <select value={selectedDraftId} onChange={(e) => onChange(e.target.value)}
        style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--color-border)' }}>
        {drafts.map((d) => (
          <option key={d.id} value={d.id}>
            Draft {d.draftNumber} — {d.submittedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
          </option>
        ))}
      </select>
    </div>
  );
}
