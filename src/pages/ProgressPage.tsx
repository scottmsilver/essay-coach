import { useState, useEffect } from 'react';
import { collection, query, orderBy, getDocs } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { useEssays } from '../hooks/useEssays';
import { TRAIT_KEYS, TRAIT_LABELS } from '../types';
import type { TraitKey } from '../types';
import { LineChart, Line, XAxis, YAxis, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface DataPoint {
  label: string;
  [key: string]: string | number;
}

const TRAIT_COLORS: Record<TraitKey, string> = {
  ideas: '#4f46e5',
  organization: '#059669',
  voice: '#d97706',
  wordChoice: '#dc2626',
  sentenceFluency: '#7c3aed',
  conventions: '#0891b2',
  presentation: '#be185d',
};

export default function ProgressPage() {
  const { user } = useAuth();
  const { essays, loading: essaysLoading } = useEssays();
  const [dataPoints, setDataPoints] = useState<DataPoint[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || essaysLoading) return;

    async function fetchAllDrafts() {
      const points: DataPoint[] = [];
      for (const essay of essays) {
        const draftsQuery = query(
          collection(db, `users/${user!.uid}/essays/${essay.id}/drafts`),
          orderBy('draftNumber', 'asc')
        );
        const snapshot = await getDocs(draftsQuery);
        for (const doc of snapshot.docs) {
          const data = doc.data();
          if (data.evaluation) {
            const point: DataPoint = {
              label: `${essay.title} (D${data.draftNumber})`,
            };
            for (const trait of TRAIT_KEYS) {
              point[trait] = data.evaluation.traits[trait]?.score ?? 0;
            }
            points.push(point);
          }
        }
      }
      setDataPoints(points);
      setLoading(false);
    }

    fetchAllDrafts();
  }, [user, essays, essaysLoading]);

  if (loading || essaysLoading) return <div className="loading-state"><div className="spinner" /><p>Loading progress...</p></div>;

  if (dataPoints.length === 0) {
    return (
      <div className="empty-state">
        <h2>Progress</h2>
        <p>No progress data yet. Submit and revise essays to see your growth over time.</p>
      </div>
    );
  }

  return (
    <div>
      <h2>Progress</h2>
      <p style={{ color: 'var(--color-text-secondary)', marginBottom: 24 }}>
        Track your writing growth across essays and drafts.
      </p>
      <div style={{ background: 'var(--color-surface)', border: '1px solid var(--color-border)', borderRadius: 10, padding: 24 }}>
        <ResponsiveContainer width="100%" height={400}>
          <LineChart data={dataPoints}>
            <XAxis dataKey="label" fontSize={11} angle={-30} textAnchor="end" height={80} />
            <YAxis domain={[0, 6]} ticks={[1, 2, 3, 4, 5, 6]} fontSize={12} />
            <Tooltip />
            <Legend />
            {TRAIT_KEYS.map((trait) => (
              <Line
                key={trait}
                type="monotone"
                dataKey={trait}
                name={TRAIT_LABELS[trait]}
                stroke={TRAIT_COLORS[trait]}
                strokeWidth={2}
                dot={{ r: 4 }}
              />
            ))}
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
