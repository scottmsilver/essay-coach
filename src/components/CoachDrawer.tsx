import type { ReportKey } from '../types';
import { REPORT_LABELS } from '../types';
import { relativeTime } from '../utils';
import type { CoachDrawerProps } from '../hooks/useNavbarContext';

type Props = CoachDrawerProps;

// No icons — just clean text labels

const READINESS_LABELS: Record<string, string> = {
  keep_going: 'Keep Going.',
  getting_close: 'Getting Close.',
  almost_there: 'Almost There.',
  ready: 'Ready.',
};

const FIVE_MINUTES = 5 * 60 * 1000;

export default function CoachDrawer({
  synthesis,
  synthesisStatus,
  activeReport,
  onSelectReport,
  hasPrompt,
  isOwner,
  isLatestDraft,
  hasUnsavedEdits,
  draftAge,
  reportLoading,
  rawIssueCounts,
  onReanalyze,
  reanalyzing,
  draftOptions,
  activeDraftId,
  onPickDraft,
  lastSaved,
  gdocChanged,
  gdocLastChecked,
}: Props) {
  const isReady = synthesis?.readiness === 'ready';
  // Old data = draft predates the synthesis feature (submitted >5min ago with no synthesis fields)
  const isOldData = !synthesis && !synthesisStatus && draftAge > FIVE_MINUTES;
  // New draft still waiting for synthesis to start
  const isWaiting = !synthesis && !synthesisStatus && draftAge <= FIVE_MINUTES;
  const isLoading = isWaiting || (!synthesis && !!synthesisStatus && synthesisStatus.stage !== 'error');
  const isError = synthesisStatus?.stage === 'error';

  const canEdit = isOwner && isLatestDraft;
  const reportKeys: ReportKey[] = [
    'overall' as ReportKey,
    'grammar' as ReportKey,
    'transitions' as ReportKey,
    ...(hasPrompt ? ['prompt'] as ReportKey[] : []),
  ];

  return (
    <div className="coach-drawer-inner">
      {/* Verdict */}
      <div className={`coach-verdict-compact ${isReady ? 'coach-verdict-ready' : ''}`}>
        {isOldData ? (
          <>
            <div className="coach-verdict-status">Feedback Ready</div>
            <div className="coach-verdict-note">
              Select a report below to review your essay.
            </div>
          </>
        ) : isWaiting ? (
          <>
            <div className="coach-verdict-status">Evaluating...</div>
            <div className="coach-verdict-note">
              Your essay is being analyzed. Results will appear shortly.
            </div>
          </>
        ) : isLoading ? (
          <>
            <div className="coach-verdict-status">Analyzing...</div>
            <div className="coach-verdict-note">
              {synthesisStatus?.message || 'Reading your essay and preparing feedback...'}
            </div>
          </>
        ) : isError ? (
          <>
            <div className="coach-verdict-status">Feedback Ready</div>
            <div className="coach-verdict-note">
              Reports are available below. Coach summary couldn't load.
            </div>
          </>
        ) : synthesis ? (
          <>
            <div className="coach-verdict-status">
              {READINESS_LABELS[synthesis.readiness] || synthesis.readiness}
            </div>
            <div className="coach-verdict-note">{synthesis.coachNote}</div>
          </>
        ) : null}
      </div>

      {/* Essay + version section — always visible */}
      <div className="coach-essay-section">
        {canEdit && (
          <div
            className={`coach-sb-essay ${activeReport === 'essay' ? 'coach-sb-essay-active' : ''}`}
            onClick={() => onSelectReport('essay' as ReportKey)}
          >
            <div className="coach-sb-name">
              {hasUnsavedEdits ? 'Essay (revised)' : 'Essay'}
              {hasUnsavedEdits && <span className="coach-sb-unsaved-dot" title="Unsaved edits" />}
              <span className="coach-sb-edit-link">edit</span>
            </div>
          </div>
        )}
        <div className="coach-essay-actions">
          {draftOptions.length > 1 && (
            <select
              className="coach-draft-select"
              value={activeDraftId}
              onChange={(e) => onPickDraft(e.target.value)}
            >
              {draftOptions.map((d) => (
                <option key={d.id} value={d.id}>{d.label}</option>
              ))}
            </select>
          )}
          {canEdit && (
            <button
              className="coach-reanalyze-btn"
              onClick={onReanalyze}
              disabled={reanalyzing}
            >
              {reanalyzing ? 'Analyzing...' : 'Re-analyze'}
            </button>
          )}
        </div>
        {canEdit && lastSaved && (
          <div className="coach-last-edited">
            Edited {relativeTime(lastSaved)}
          </div>
        )}
        {gdocChanged && gdocLastChecked && (
          <div className="coach-last-edited coach-gdoc-changed">
            Doc updated {relativeTime(gdocLastChecked)} — re-analyze to refresh
          </div>
        )}
      </div>

      {/* Reports */}
      <div className="coach-sidebar-label">Reports</div>
      <div className="coach-report-list">
        {reportKeys.map((key) => {
          const isEssay = false;
          const summary = isEssay ? null : synthesis?.reportSummaries?.find((r) => r.key === key);
          const isActive = activeReport === key;
          const count = summary?.issueCount ?? rawIssueCounts[key] ?? undefined;
          const isCleared = count === 0;
          const isRecommended = !isEssay && synthesis?.recommendedReport === key;

          return (
            <div
              key={key}
              className={[
                'coach-sb-report',
                isActive ? 'coach-sb-report-active' : '',
                isCleared && !isEssay ? 'coach-sb-report-cleared' : '',
              ].join(' ')}
              onClick={() => onSelectReport(key)}
            >
              <div className="coach-sb-info">
                <div className="coach-sb-name">
                  {isEssay ? (hasUnsavedEdits ? 'Essay (revised)' : 'Essay') : REPORT_LABELS[key]}
                  {isEssay && hasUnsavedEdits && (
                    <span className="coach-sb-unsaved-dot" title="Unsaved edits" />
                  )}
                  {isRecommended && !isCleared && (
                    <span className="coach-sb-badge coach-sb-badge-rec">Focus</span>
                  )}
                  {isCleared && !isEssay && (
                    <span className="coach-sb-badge coach-sb-badge-clear">✓</span>
                  )}
                </div>
                {!isEssay && summary && summary.detail && (
                  <div className="coach-sb-detail">{summary.detail}</div>
                )}
                {summary && summary.previousCount !== null && summary.previousCount > 0 && (
                  <div className="coach-sb-bar">
                    <div
                      className="coach-sb-bar-fill"
                      style={{
                        width: `${Math.min(100, Math.max(0, ((summary.previousCount - summary.issueCount) / summary.previousCount) * 100))}%`,
                        background: isCleared ? 'var(--color-success)' : 'var(--color-accent)',
                      }}
                    />
                  </div>
                )}
              </div>
              {!isEssay && (() => {
                const loading = reportLoading[key as keyof typeof reportLoading];
                const count = summary?.issueCount ?? rawIssueCounts[key] ?? undefined;
                if (loading) return <div className="coach-sb-spinner" />;
                if (count === undefined) return <div className="coach-sb-count coach-sb-count-few">—</div>;
                return (
                  <div className={`coach-sb-count ${
                    count === 0 ? 'coach-sb-count-clear' :
                    count > 2 ? 'coach-sb-count-issues' :
                    'coach-sb-count-few'
                  }`}>
                    {count}
                  </div>
                );
              })()}
            </div>
          );
        })}
      </div>

      {/* Footer hint */}
      {synthesis?.recommendedReport && !isReady && (
        <div className="coach-sb-footer">
          <div className="coach-sb-footer-hint">
            Coach suggests {(REPORT_LABELS[synthesis.recommendedReport] || synthesis.recommendedReport || '').toLowerCase()} next
          </div>
        </div>
      )}
    </div>
  );
}
