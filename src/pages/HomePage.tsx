import { Link } from 'react-router-dom';
import { Button } from '@mantine/core';
import { useEssays } from '../hooks/useEssays';
import { useAuth } from '../hooks/useAuth';

export default function HomePage() {
  const { essays, loading } = useEssays();
  const { user } = useAuth();

  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading essays...</p></div>;

  if (essays.length === 0) {
    return (
      <div className="empty-state">
        <h2>Welcome to EssayCoach</h2>
        <p>Submit your first essay to get feedback and start improving your writing.</p>
        <Button component={Link} to="/new">Write Your First Essay</Button>
      </div>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2>My Essays</h2>
        <Button component={Link} to="/new" size="sm">New Essay</Button>
      </div>
      <ul className="essay-list">
        {essays.map((essay) => {
          const isShared = essay.ownerUid !== user?.uid;
          const essayUrl = isShared
            ? `/user/${essay.ownerUid}/essay/${essay.id}`
            : `/essay/${essay.id}`;
          return (
            <Link key={`${essay.ownerUid}_${essay.id}`} to={essayUrl} className="essay-list-item">
              <div>
                <strong>{essay.title}</strong>
                <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                  {essay.writingType} · Draft {essay.currentDraftNumber}
                  {isShared && (
                    <span style={{ marginLeft: 8, color: 'var(--color-accent)', fontStyle: 'italic' }}>
                      Shared by {essay.ownerEmail}
                    </span>
                  )}
                </div>
              </div>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)' }}>
                {essay.updatedAt.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
              </div>
            </Link>
          );
        })}
      </ul>
    </div>
  );
}
