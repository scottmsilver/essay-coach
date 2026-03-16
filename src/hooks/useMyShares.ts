import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

interface MyShareEntry {
  sharedWithUid: string | null;
  sharedWithEmail: string;
  pending: boolean;
}

export function useMyShares() {
  const { user } = useAuth();
  const [shares, setShares] = useState<MyShareEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    const q = query(
      collection(db, 'shares'),
      where('ownerUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setShares(snapshot.docs.map((doc) => ({
        sharedWithUid: doc.data().sharedWithUid ?? null,
        sharedWithEmail: doc.data().sharedWithEmail,
        pending: doc.data().pending ?? false,
      })));
      setLoading(false);
    }, (error) => {
      console.error('useMyShares listener error:', error);
      setLoading(false);
    });
    return unsubscribe;
  }, [user]);

  return { shares, loading };
}
