import type { ReactNode } from 'react';
import type { EvaluationStatus } from '../types';

interface Props {
  data: unknown;
  error: string | null;
  loading: boolean;
  status?: EvaluationStatus | null;
  onRetry: () => void;
  defaultMessage: string;
  placeholder: string;
  children: ReactNode;
}

export default function AnalysisPanel({ data, error, loading, status, onRetry, defaultMessage, placeholder, children }: Props) {
  if (data) return <>{children}</>;

  if (error) {
    return (
      <div className="error-state">
        <p>{error}</p>
        <button className="btn-primary" style={{ marginTop: 8 }} onClick={onRetry}>
          Retry
        </button>
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
