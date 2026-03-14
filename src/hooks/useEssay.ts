import { useState, useEffect } from 'react';
import { doc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import type { Essay, Draft } from '../types';

export function useEssay(essayId: string | undefined) {
  const { user } = useAuth();
  const [essay, setEssay] = useState<Essay | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user || !essayId) return;
    const essayRef = doc(db, `users/${user.uid}/essays/${essayId}`);
    const unsubEssay = onSnapshot(essayRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setEssay({ id: snapshot.id, ...data,
          createdAt: data.createdAt?.toDate() ?? new Date(),
          updatedAt: data.updatedAt?.toDate() ?? new Date(),
        } as Essay);
      }
    });
    const draftsQuery = query(
      collection(db, `users/${user.uid}/essays/${essayId}/drafts`),
      orderBy('draftNumber', 'desc')
    );
    const unsubDrafts = onSnapshot(draftsQuery, (snapshot) => {
      const result: Draft[] = snapshot.docs.map((d) => ({
        id: d.id, ...d.data(), submittedAt: d.data().submittedAt?.toDate() ?? new Date(),
      })) as Draft[];
      setDrafts(result);
      setLoading(false);
    });
    return () => { unsubEssay(); unsubDrafts(); };
  }, [user, essayId]);

  return { essay, drafts, loading };
}
