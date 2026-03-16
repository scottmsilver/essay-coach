import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, User } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { auth, googleProvider, db, functions } from '../firebase';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  allowed: boolean | null;
  signIn: () => Promise<void>;
  logOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        const allowlistDoc = await getDoc(doc(db, 'config', 'allowlist'));
        const emails: string[] = allowlistDoc.data()?.emails ?? [];
        const isAllowed = emails.includes(firebaseUser.email?.toLowerCase() ?? '');
        setAllowed(isAllowed);

        if (isAllowed) {
          const userDocRef = doc(db, 'users', firebaseUser.uid);
          const userDoc = await getDoc(userDocRef);
          if (!userDoc.exists()) {
            await setDoc(userDocRef, {
              displayName: firebaseUser.displayName ?? '',
              email: firebaseUser.email ?? '',
              createdAt: serverTimestamp(),
            });
          }
          // Resolve any pending shares addressed to this user's email.
          // Fire-and-forget: don't block sign-in on this.
          const resolve = httpsCallable(functions, 'resolvePendingShares');
          resolve().catch((err) =>
            console.warn('Failed to resolve pending shares:', err)
          );
        }
      } else {
        setAllowed(null);
      }
      setLoading(false);
    });
    return unsubscribe;
  }, []);

  const signIn = async () => { await signInWithPopup(auth, googleProvider); };
  const logOut = async () => { await signOut(auth); setAllowed(null); };

  return (
    <AuthContext.Provider value={{ user, loading, allowed, signIn, logOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used within AuthProvider');
  return context;
}
