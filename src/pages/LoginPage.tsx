import { useState } from 'react';
import { Navigate } from 'react-router-dom';
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

  if (loading) return <div className="center">Loading...</div>;
  if (user && allowed) return <Navigate to="/" />;

  const handleDevSignIn = async (email: string) => {
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
  };

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
