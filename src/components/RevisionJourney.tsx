import type { Draft, CoachSynthesis } from '../types';

interface Props {
  drafts: Draft[];
}

export default function RevisionJourney({ drafts }: Props) {
  // Sort drafts by draftNumber ascending
  const sorted = [...drafts].sort((a, b) => a.draftNumber - b.draftNumber);

  return (
    <div className="revision-journey">
      <div className="revision-journey-title">Your Revision Journey</div>
      {sorted.map((draft, i) => {
        const isLast = i === sorted.length - 1;
        const synthesis: CoachSynthesis | null | undefined = draft.coachSynthesis;
        const isReady = synthesis?.readiness === 'ready';

        // Build summary from coach synthesis or fallback to report summaries
        let summary = '';
        if (synthesis?.coachNote) {
          summary = synthesis.coachNote;
        } else if (draft.evaluation) {
          const scores = Object.values(draft.evaluation.traits)
            .map((t) => (t as { score: number }).score);
          const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
          summary = `Average score: ${avg.toFixed(1)}/6`;
        }

        // Count total issues from report summaries
        const totalIssues = synthesis?.reportSummaries
          ?.reduce((sum, r) => sum + r.issueCount, 0) ?? null;

        return (
          <div key={draft.id} className="revision-journey-step">
            <div className={`revision-journey-dot ${
              isReady ? 'revision-journey-dot-done' :
              isLast ? 'revision-journey-dot-current' :
              'revision-journey-dot-past'
            }`}>
              {draft.draftNumber}
            </div>
            <div className="revision-journey-content">
              <div className="revision-journey-label">
                Draft {draft.draftNumber}
                {totalIssues !== null && (
                  <span className={`revision-journey-count ${
                    totalIssues === 0 ? 'revision-journey-count-clear' : ''
                  }`}>
                    {totalIssues === 0 ? 'All clear' : `${totalIssues} issues`}
                  </span>
                )}
              </div>
              {summary && (
                <div className="revision-journey-desc">{summary}</div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
