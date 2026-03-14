interface Props { revisionPlan: string[]; }

export default function RevisionPlanBanner({ revisionPlan }: Props) {
  if (revisionPlan.length === 0) return null;
  return (
    <div className="revision-banner">
      <h3>Your Revision Plan</h3>
      <div className="revision-steps">
        {revisionPlan.map((step, i) => (
          <span key={i} className={`revision-step ${i === 0 ? 'active' : ''}`}>
            {i + 1}. {step}
          </span>
        ))}
      </div>
    </div>
  );
}
