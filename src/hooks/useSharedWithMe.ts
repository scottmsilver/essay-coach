import { useState, useEffect, useRef } from 'react';
import { collection, query, where, orderBy, onSnapshot, DocumentData, QuerySnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

interface SharedWithMeEntry {
  ownerUid: string;
  ownerEmail: string;
}

export function useSharedWithMe() {
  const { user } = useAuth();
  const [shares, setShares] = useState<SharedWithMeEntry[]>([]);
  const [loading, setLoading] = useState(true);

  // Track results from both queries so we can merge them
  const byUidResults = useRef<SharedWithMeEntry[]>([]);
  const byEmailResults = useRef<SharedWithMeEntry[]>([]);
  const loadedCount = useRef(0);

  useEffect(() => {
    if (!user) return;

    loadedCount.current = 0;
    byUidResults.current = [];
    byEmailResults.current = [];

    function mergeAndSet() {
      // De-duplicate by ownerUid (a resolved share and pending share for the same
      // owner should only appear once; the UID-based one takes precedence)
      const seen = new Set<string>();
      const merged: SharedWithMeEntry[] = [];
      for (const entry of [...byUidResults.current, ...byEmailResults.current]) {
        if (!seen.has(entry.ownerUid)) {
          seen.add(entry.ownerUid);
          merged.push(entry);
        }
      }
      setShares(merged);
    }

    function parseSnapshot(snapshot: QuerySnapshot<DocumentData>): SharedWithMeEntry[] {
      return snapshot.docs
        .filter((doc) => doc.data().ownerUid) // safety check
        .map((doc) => ({
          ownerUid: doc.data().ownerUid,
          ownerEmail: doc.data().ownerEmail,
        }));
    }

    // Query 1: shares resolved by UID (existing behavior)
    const qByUid = query(
      collection(db, 'shares'),
      where('sharedWithUid', '==', user.uid),
      orderBy('createdAt', 'desc'),
    );

    const unsub1 = onSnapshot(qByUid, (snapshot) => {
      byUidResults.current = parseSnapshot(snapshot);
      loadedCount.current |= 1;
      mergeAndSet();
      if (loadedCount.current === 3) setLoading(false);
    }, (error) => {
      console.error('useSharedWithMe (byUid) listener error:', error);
      loadedCount.current |= 1;
      if (loadedCount.current === 3) setLoading(false);
    });

    // Query 2: pending shares by email (for shares created before the user had an account)
    const userEmail = user.email?.toLowerCase();
    let unsub2: (() => void) | undefined;

    if (userEmail) {
      const qByEmail = query(
        collection(db, 'shares'),
        where('sharedWithEmail', '==', userEmail),
        where('pending', '==', true),
        orderBy('createdAt', 'desc'),
      );

      unsub2 = onSnapshot(qByEmail, (snapshot) => {
        byEmailResults.current = parseSnapshot(snapshot);
        loadedCount.current |= 2;
        mergeAndSet();
        if (loadedCount.current === 3) setLoading(false);
      }, (error) => {
        console.error('useSharedWithMe (byEmail) listener error:', error);
        loadedCount.current |= 2;
        if (loadedCount.current === 3) setLoading(false);
      });
    } else {
      loadedCount.current |= 2;
      if (loadedCount.current === 3) setLoading(false);
    }

    return () => {
      unsub1();
      unsub2?.();
    };
  }, [user]);

  return { shares, loading };
}
