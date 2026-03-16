import { useState, useEffect, useRef } from 'react';
import { collection, query, orderBy, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';
import { useSharedWithMe } from './useSharedWithMe';
import type { EssayListItem } from '../types';

function parseEssayDoc(doc: any, ownerUid: string, ownerEmail: string): EssayListItem {
  const data = doc.data();
  return {
    id: doc.id,
    ...data,
    createdAt: data.createdAt?.toDate() ?? new Date(),
    updatedAt: data.updatedAt?.toDate() ?? new Date(),
    ownerUid,
    ownerEmail,
  } as EssayListItem;
}

export function useEssays() {
  const { user } = useAuth();
  const { shares, loading: sharesLoading } = useSharedWithMe();
  const [ownEssays, setOwnEssays] = useState<EssayListItem[]>([]);
  const [sharedEssaysByOwner, setSharedEssaysByOwner] = useState<Record<string, EssayListItem[]>>({});
  const [ownLoading, setOwnLoading] = useState(true);
  const [sharedLoadingCount, setSharedLoadingCount] = useState(0);
  const activeListeners = useRef<Record<string, () => void>>({});
  const resolvedOwners = useRef<Set<string>>(new Set());

  // Own essays listener
  useEffect(() => {
    if (!user) return;
    const q = query(collection(db, `users/${user.uid}/essays`), orderBy('updatedAt', 'desc'));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      setOwnEssays(snapshot.docs.map((doc) =>
        parseEssayDoc(doc, user.uid, user.email ?? '')
      ));
      setOwnLoading(false);
    });
    return unsubscribe;
  }, [user]);

  // Teardown all shared listeners on unmount only
  useEffect(() => {
    return () => {
      Object.values(activeListeners.current).forEach((unsub) => unsub());
      activeListeners.current = {};
      resolvedOwners.current.clear();
    };
  }, []);

  // Shared essays listeners — diff against current listeners
  useEffect(() => {
    if (sharesLoading) return;

    const currentOwnerUids = new Set(shares.map((s) => s.ownerUid));
    const activeOwnerUids = new Set(Object.keys(activeListeners.current));

    // Remove listeners for owners no longer shared
    for (const uid of activeOwnerUids) {
      if (!currentOwnerUids.has(uid)) {
        activeListeners.current[uid]();
        delete activeListeners.current[uid];
        resolvedOwners.current.delete(uid);
        setSharedEssaysByOwner((prev) => {
          const next = { ...prev };
          delete next[uid];
          return next;
        });
      }
    }

    // Add listeners for new owners
    for (const share of shares) {
      if (activeListeners.current[share.ownerUid]) continue;
      setSharedLoadingCount((c) => c + 1);

      const q = query(
        collection(db, `users/${share.ownerUid}/essays`),
        orderBy('updatedAt', 'desc'),
      );
      const ownerUid = share.ownerUid;
      const ownerEmail = share.ownerEmail;
      const unsubscribe = onSnapshot(
        q,
        (snapshot) => {
          setSharedEssaysByOwner((prev) => ({
            ...prev,
            [ownerUid]: snapshot.docs.map((doc) =>
              parseEssayDoc(doc, ownerUid, ownerEmail)
            ),
          }));
          // Only decrement loading count on the first snapshot from this owner
          if (!resolvedOwners.current.has(ownerUid)) {
            resolvedOwners.current.add(ownerUid);
            setSharedLoadingCount((c) => Math.max(0, c - 1));
          }
        },
        (error) => {
          console.error(`Failed to load essays for shared user ${ownerUid}:`, error);
          if (!resolvedOwners.current.has(ownerUid)) {
            resolvedOwners.current.add(ownerUid);
            setSharedLoadingCount((c) => Math.max(0, c - 1));
          }
        },
      );
      activeListeners.current[ownerUid] = unsubscribe;
    }
  }, [shares, sharesLoading]);

  // Merge and sort
  const allSharedEssays = Object.values(sharedEssaysByOwner).flat();
  const essays = [...ownEssays, ...allSharedEssays].sort(
    (a, b) => b.updatedAt.getTime() - a.updatedAt.getTime()
  );

  const loading = ownLoading || sharesLoading || sharedLoadingCount > 0;

  return { essays, loading };
}
