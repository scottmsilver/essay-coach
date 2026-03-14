import { useAuth } from '../hooks/useAuth';
import { Navigate } from 'react-router-dom';

export default function LoginPage() {
  const { user, loading, allowed, signIn, logOut } = useAuth();

  if (loading) return <div className="center">Loading...</div>;
  if (user && allowed) return <Navigate to="/" />;

  return (
    <div className="login-page">
      <h1>EssayCoach</h1>
      <p>Get feedback on your writing and improve through revision.</p>
      {user && allowed === false ? (
        <div className="access-denied">
          <p>You don't have access yet. Contact the administrator.</p>
          <button onClick={logOut}>Sign out</button>
        </div>
      ) : (
        <button className="google-sign-in" onClick={signIn}>
          Sign in with Google
        </button>
      )}
    </div>
  );
}
