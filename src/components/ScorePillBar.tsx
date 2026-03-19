import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey, Evaluation } from '../types';
import { scoreLevel } from '../utils';

interface ScoreChange {
  delta: number;
}

interface Props {
  evaluation: Evaluation;
  activeKey: TraitKey | null;
  onSelect: (key: TraitKey | null) => void;
  scoreChanges?: Partial<Record<TraitKey, ScoreChange>>;
  showPriority?: boolean;
}

export default function ScorePillBar({ evaluation, activeKey, onSelect, scoreChanges, showPriority }: Props) {
  return (
    <div className="analysis-bar-scores">
      {TRAIT_KEYS.map((trait) => {
        const traitData = evaluation.traits[trait];
        const score = traitData.score;
        const isActive = activeKey === trait;
        const change = scoreChanges?.[trait];
        const improved = change && change.delta > 0;
        return (
          <button
            key={trait}
            className={`score-pill ${scoreLevel(score)} ${isActive ? 'active' : ''} ${improved ? 'improved' : ''}`}
            onClick={() => onSelect(isActive ? null : trait)}
            title={traitData.feedback}
          >
            <span className="score-pill-label">{TRAIT_LABELS[trait]}</span>
            <span className="score-pill-value">{score}</span>
            {change && change.delta !== 0 && (
              <span className={`score-pill-delta ${change.delta > 0 ? 'up' : 'down'}`}>
                {change.delta > 0 ? '+' : ''}{change.delta}
              </span>
            )}
            {showPriority && traitData.revisionPriority !== null && (
              <span className="score-pill-priority">#{traitData.revisionPriority}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
