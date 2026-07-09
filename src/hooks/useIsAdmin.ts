import { useEffect, useState } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from './useAuth';

/**
 * Cosmetic admin check for the client (nav gating only — the real
 * enforcement lives in the Cloud Functions via `isEmailAdmin`, see
 * functions/src/admins.ts). Reads `config/admins` once per signed-in user
 * and compares the user's lowercased email against `emails[]`.
 *
 * Resolves to `{ isAdmin: false, loading: false }` if the user is signed
 * out, the doc is missing, the email isn't a member, or the read fails
 * (e.g. a permission error) — never throws.
 */
export function useIsAdmin(): { isAdmin: boolean; loading: boolean } {
  const { user } = useAuth();
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    if (!user) {
      setIsAdmin(false);
      setLoading(false);
      return;
    }

    setLoading(true);
    getDoc(doc(db, 'config', 'admins'))
      .then((snapshot) => {
        if (cancelled) return;
        const emails: string[] = snapshot.data()?.emails ?? [];
        const email = user.email?.toLowerCase() ?? '';
        setIsAdmin(emails.includes(email));
      })
      .catch(() => {
        if (cancelled) return;
        setIsAdmin(false);
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user]);

  return { isAdmin, loading };
}
