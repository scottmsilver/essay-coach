import type { ReactNode } from 'react';
import { Button } from '@mantine/core';
import type { EvaluationStatus } from '../types';

interface Props {
  data: unknown;
  error: string | null;
  loading: boolean;
  status?: EvaluationStatus | null;
  onRetry: () => void;
  onRerun?: () => void;
  rerunLoading?: boolean;
  defaultMessage: string;
  placeholder: string;
  children: ReactNode;
}

export default function AnalysisPanel({ data, error, loading, status, onRetry, onRerun, rerunLoading, defaultMessage, placeholder, children }: Props) {
  if (data) {
    return (
      <>
        {children}
        {onRerun && (
          <div className="analysis-rerun">
            <button
              className="analysis-rerun-btn"
              onClick={onRerun}
              disabled={rerunLoading}
              title="Re-run this analysis on the current draft"
            >
              {rerunLoading ? '↻ Running...' : '↻ Re-run'}
            </button>
          </div>
        )}
      </>
    );
  }

  if (error) {
    return (
      <div className="error-state">
        <p>{error}</p>
        <Button size="sm" mt={8} onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  }

  if (status?.stage === 'pending') {
    return (
      <div className="loading-state">
        <p className="progress-message">{status.message || 'Queued...'}</p>
        <p className="progress-stage">Analysis will begin shortly</p>
      </div>
    );
  }

  if (loading || status) {
    return (
      <div className="loading-state">
        <div className="spinner" />
        <p className="progress-message">{status?.message || defaultMessage}</p>
        {status?.stage === 'thinking' && <p className="progress-stage">Gemini is thinking...</p>}
        {status?.stage === 'generating' && <p className="progress-stage">Writing analysis...</p>}
      </div>
    );
  }

  return (
    <div className="loading-state">
      <p>{placeholder}</p>
    </div>
  );
}
