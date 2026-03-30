import { useState, useEffect, useRef } from 'react';
import { doc, collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import type { Essay, Draft } from '../types';

export function useEssay(essayId: string | undefined, ownerUid?: string) {
  const { user } = useAuth();
  const [essay, setEssay] = useState<Essay | null>(null);
  const [drafts, setDrafts] = useState<Draft[]>([]);
  const [loading, setLoading] = useState(true);
  const essayResolved = useRef(false);
  const draftsResolved = useRef(false);

  useEffect(() => {
    essayResolved.current = false;
    draftsResolved.current = false;
    setLoading(true);

    if (!user || !essayId) return;
    const uid = ownerUid ?? user.uid;
    const essayRef = doc(db, `users/${uid}/essays/${essayId}`);
    const unsubEssay = onSnapshot(essayRef, (snapshot) => {
      if (snapshot.exists()) {
        const data = snapshot.data();
        setEssay({ id: snapshot.id, ...data,
          createdAt: data.createdAt?.toDate() ?? new Date(),
          updatedAt: data.updatedAt?.toDate() ?? new Date(),
        } as Essay);
      } else {
        setEssay(null);
      }
      essayResolved.current = true;
      if (draftsResolved.current) setLoading(false);
    });
    const draftsQuery = query(
      collection(db, `users/${uid}/essays/${essayId}/drafts`),
      orderBy('draftNumber', 'desc')
    );
    const unsubDrafts = onSnapshot(draftsQuery, (snapshot) => {
      const result: Draft[] = snapshot.docs.map((d) => {
        const data = d.data();
        return {
          id: d.id, ...data,
          submittedAt: data.submittedAt?.toDate() ?? new Date(),
          editedAt: data.editedAt?.toDate() ?? null,
          lastScannedAt: data.lastScannedAt?.toDate() ?? null,
        };
      }) as Draft[];
      setDrafts(result);
      draftsResolved.current = true;
      if (essayResolved.current) setLoading(false);
    });
    return () => { unsubEssay(); unsubDrafts(); };
  }, [user, essayId, ownerUid]);

  return { essay, drafts, loading };
}
