import { useState, useEffect, useRef, useCallback } from 'react';
import { Navigate, useSearchParams } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { signInWithCustomToken } from 'firebase/auth';
import { Button, Stack } from '@mantine/core';
import { useAuth } from '../hooks/useAuth';
import { functions, auth } from '../firebase';

const DEV_USERS = [
  { email: 'dev-alice@essaycoach.test', label: 'Alice (Dev)' },
  { email: 'dev-bob@essaycoach.test', label: 'Bob (Dev)' },
];

export default function LoginPage() {
  const { user, loading, allowed, signIn, logOut } = useAuth();
  const [devLoading, setDevLoading] = useState(false);
  const [searchParams] = useSearchParams();
  const autoLoginRef = useRef(false);

  const handleDevSignIn = useCallback(async (email: string) => {
    setDevLoading(true);
    try {
      const devSignIn = httpsCallable<{ email: string }, { token: string }>(functions, 'devSignIn');
      const result = await devSignIn({ email });
      await signInWithCustomToken(auth, result.data.token);
    } catch (err) {
      console.error('Dev sign-in failed:', err);
    } finally {
      setDevLoading(false);
    }
  }, []);

  // Auto-login via ?as=alice or ?as=bob (dev/headless QA passthrough)
  const asParam = searchParams.get('as');
  useEffect(() => {
    if (!asParam || autoLoginRef.current || user) return;
    const devUser = DEV_USERS.find(u => u.label.toLowerCase().includes(asParam.toLowerCase()));
    if (devUser) {
      autoLoginRef.current = true;
      (async () => {
        try {
          const fn = httpsCallable<{ email: string }, { token: string }>(functions, 'devSignIn');
          const result = await fn({ email: devUser.email });
          await signInWithCustomToken(auth, result.data.token);
          // Hard redirect so Playwright doesn't lose the page context
          const target = searchParams.get('then') || '/';
          window.location.href = target;
        } catch (err) {
          console.error('Auto dev sign-in failed:', err);
        }
      })();
    }
  }, [asParam, user, handleDevSignIn, searchParams]);

  if (loading || (asParam && !user)) return <div className="center">Loading...</div>;
  if (user && allowed) return <Navigate to="/" />;

  return (
    <div className="login-page">
      <h1>EssayCoach</h1>
      <p>Get feedback on your writing and improve through revision.</p>
      {user && allowed === false ? (
        <div className="access-denied">
          <p>You don't have access yet. Contact the administrator.</p>
          <Button variant="default" onClick={logOut}>Sign out</Button>
        </div>
      ) : (
        <>
          <Button onClick={signIn} size="lg" variant="outline" color="dark" fullWidth style={{ maxWidth: 320 }}>
            Sign in with Google
          </Button>
          {import.meta.env.DEV && (
            <div style={{ marginTop: 24, padding: 16, border: '1px dashed var(--color-text-secondary)', borderRadius: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--color-text-secondary)', marginBottom: 8 }}>Dev Login</div>
              <Stack gap="xs">
                {DEV_USERS.map((u) => (
                  <Button
                    key={u.email}
                    variant="default"
                    fullWidth
                    onClick={() => handleDevSignIn(u.email)}
                    disabled={devLoading}
                  >
                    {u.label}
                  </Button>
                ))}
              </Stack>
            </div>
          )}
        </>
      )}
    </div>
  );
}
