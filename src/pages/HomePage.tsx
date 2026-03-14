import { Link } from 'react-router-dom';
import { useEssays } from '../hooks/useEssays';

export default function HomePage() {
  const { essays, loading } = useEssays();

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essays...</p></div>;

  if (essays.length === 0) {
    return (
      <div className="empty-state">
        <h2>Welcome to EssayCoach</h2>
        <p>Submit your first essay to get feedback and start improving your writing.</p>
        <Link to="/new" className="btn-primary">Write Your First Essay</Link>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>My Essays</h2>
        <Link to="/new" className="btn-primary">New Essay</Link>
      </div>
      <ul className="essay-list">
        {essays.map((essay) => (
          <Link key={essay.id} to={`/essay/${essay.id}`} className="essay-list-item">
            <div>
              <strong>{essay.title}</strong>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {essay.writingType} · Draft {essay.currentDraftNumber}
              </div>
            </div>
            <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
              {essay.updatedAt.toLocaleDateString()}
            </div>
          </Link>
        ))}
      </ul>
    </div>
  );
}
