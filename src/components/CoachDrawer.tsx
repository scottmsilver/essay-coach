import type { ReportKey } from '../types';
import { REPORT_KEYS, REPORT_LABELS } from '../types';
import { relativeTime } from '../utils';
import type { DraftEntity } from '../entities/draftEntity';
import type { DraftPresentation, VerdictPhase } from '../entities/draftPresentation';
import type { DraftEditorState } from '../hooks/useDraftEditor';
import type { NavbarMeta } from '../hooks/useNavbarContext';

interface Props {
  entity: DraftEntity;
  presentation: DraftPresentation;
  editor: DraftEditorState;
  meta: NavbarMeta;
}

// Platform-specific text mapping (web)
const READINESS_LABELS: Record<string, string> = {
  keep_going: 'Keep Going.',
  getting_close: 'Getting Close.',
  almost_there: 'Almost There.',
  ready: 'Ready.',
};

const PHASE_TEXT: Record<VerdictPhase, { status: string; note: string }> = {
  waiting: { status: 'Evaluating...', note: 'Your essay is being analyzed. Results will appear shortly.' },
  analyzing: { status: 'Analyzing...', note: 'Reading your essay and preparing feedback...' },
  old_data: { status: 'Feedback Ready', note: 'Select a report below to review your essay.' },
  error: { status: 'Feedback Ready', note: 'Reports are available below. Coach summary couldn\'t load.' },
  has_verdict: { status: '', note: '' },
};

export default function CoachDrawer({ entity, presentation, editor, meta }: Props) {
  const { verdict, reports, canEdit } = presentation;
  const { activeReport, onSelectReport, draftOptions, onPickDraft, onReanalyze, reanalyzing, gdocChanged, gdocLastChecked } = meta;
  const isReady = verdict.coachReadiness === 'ready';

  const reportKeys = REPORT_KEYS.filter((k): k is Exclude<ReportKey, 'essay'> =>
    k !== 'essay' && (k !== 'prompt' || presentation.hasPrompt)
  );

  return (
    <div className="coach-drawer-inner">
      {/* Verdict */}
      <div className={`coach-verdict-compact ${isReady ? 'coach-verdict-ready' : ''}`}>
        {verdict.phase === 'has_verdict' && verdict.coachReadiness ? (
          <>
            <div className="coach-verdict-status">
              {READINESS_LABELS[verdict.coachReadiness] || verdict.coachReadiness}
            </div>
            <div className="coach-verdict-note">{verdict.coachNote}</div>
          </>
        ) : verdict.phase === 'analyzing' ? (
          <>
            <div className="coach-verdict-status">{PHASE_TEXT.analyzing.status}</div>
            <div className="coach-verdict-note">
              {entity.raw.coachSynthesisStatus?.message || PHASE_TEXT.analyzing.note}
            </div>
          </>
        ) : (
          <>
            <div className="coach-verdict-status">{PHASE_TEXT[verdict.phase].status}</div>
            <div className="coach-verdict-note">{PHASE_TEXT[verdict.phase].note}</div>
          </>
        )}
      </div>

      {/* Essay + version section — always visible */}
      <div className="coach-essay-section">
        {canEdit && (
          <div
            className={`coach-sb-essay ${activeReport === 'essay' ? 'coach-sb-essay-active' : ''}`}
            onClick={() => onSelectReport('essay' as ReportKey)}
          >
            <div className="coach-sb-name">
              {editor.hasUnsavedEdits ? 'Essay (revised)' : 'Essay'}
              {editor.hasUnsavedEdits && <span className="coach-sb-unsaved-dot" title="Unsaved edits" />}
              <span className="coach-sb-edit-link">edit</span>
            </div>
          </div>
        )}
        <div className="coach-essay-actions">
          {draftOptions.length > 1 && (
            <select
              className="coach-draft-select"
              value={entity.id}
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
        {canEdit && editor.lastSaved && (
          <div className="coach-last-edited">
            Edited {relativeTime(editor.lastSaved)}
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
          const report = reports[key as keyof typeof reports];
          const isActive = activeReport === key;
          const count = report?.issueCount;
          const isCleared = count === 0;
          const isLoading = report?.status === 'loading';
          const summary = entity.raw.coachSynthesis?.reportSummaries?.find((r) => r.key === key);

          return (
            <div
              key={key}
              className={[
                'coach-sb-report',
                isActive ? 'coach-sb-report-active' : '',
                isCleared ? 'coach-sb-report-cleared' : '',
              ].join(' ')}
              onClick={() => onSelectReport(key)}
            >
              <div className="coach-sb-info">
                <div className="coach-sb-name">
                  {REPORT_LABELS[key]}
                  {report?.isRecommended && !isCleared && (
                    <span className="coach-sb-badge coach-sb-badge-rec">Focus</span>
                  )}
                  {isCleared && (
                    <span className="coach-sb-badge coach-sb-badge-clear">✓</span>
                  )}
                </div>
                {summary && summary.detail && (
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
              {(() => {
                if (isLoading) return <div className="coach-sb-spinner" />;
                if (count === undefined) return <div className="coach-sb-count coach-sb-count-unavailable">—</div>;
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
      {verdict.recommendedReport && !isReady && (
        <div className="coach-sb-footer">
          <div className="coach-sb-footer-hint">
            Coach suggests {(REPORT_LABELS[verdict.recommendedReport as ReportKey] || verdict.recommendedReport || '').toLowerCase()} next
          </div>
        </div>
      )}
    </div>
  );
}
