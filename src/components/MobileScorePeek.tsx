import type { Evaluation } from '../types';
import type { VerdictPresentation } from '../entities/draftPresentation';
import ScorePillBar from './ScorePillBar';

interface Props {
  evaluation: Evaluation | null;
  verdict: VerdictPresentation;
}

const READINESS_LABELS: Record<string, string> = {
  keep_going: 'Keep Going.',
  getting_close: 'Getting Close.',
  almost_there: 'Almost There.',
  ready: 'Ready.',
};

export default function MobileScorePeek({ evaluation, verdict }: Props) {
  const isLoading = verdict.phase === 'waiting' || verdict.phase === 'analyzing';

  return (
    <div className="mobile-peek">
      <div className="mobile-sheet-handle" />
      {isLoading ? (
        <div className="mobile-peek-loading">Analyzing your essay...</div>
      ) : (
        <>
          <div className="mobile-peek-pills">
            <ScorePillBar evaluation={evaluation ?? undefined} />
          </div>
          {verdict.coachNote && (
            <div className="mobile-peek-verdict">
              {verdict.coachReadiness && READINESS_LABELS[verdict.coachReadiness]}{' '}
              {verdict.coachNote}
            </div>
          )}
        </>
      )}
    </div>
  );
}
