import { TRAIT_LABELS, type TraitKey, type TraitEvaluation } from '../types';
import { scoreClass, scoreColor, scoreTooltip } from '../utils';

interface Props {
  traitKey: TraitKey;
  evaluation: TraitEvaluation;
  expanded: boolean;
  onClick: () => void;
}

export default function TraitCard({ traitKey, evaluation, expanded, onClick }: Props) {
  return (
    <div className={`trait-card ${scoreClass(evaluation.score)}`} onClick={onClick}>
      <div className="trait-card-header">
        <span className="trait-card-name">{TRAIT_LABELS[traitKey]}</span>
        <span className="trait-card-score" style={{ color: scoreColor(evaluation.score) }} title={scoreTooltip(evaluation.score)}>
          {evaluation.score}/6
        </span>
      </div>
      <p className="trait-card-feedback">{evaluation.feedback}</p>
      {expanded && evaluation.annotations.length > 0 && (
        <div style={{ marginTop: 12 }}>
          {evaluation.annotations.map((ann, i) => (
            <div key={i} className="annotation">
              <div className="annotation-quote">"{ann.quotedText}"</div>
              <div className="annotation-comment">{ann.comment}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
