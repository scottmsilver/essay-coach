import { Navigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading, allowed } = useAuth();
  if (loading) return <div className="center">Loading...</div>;
  if (!user || !allowed) return <Navigate to="/login" />;
  return <>{children}</>;
}
