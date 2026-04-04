import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { AuthProvider } from './hooks/useAuth';
import Layout from './components/Layout';
import ProtectedRoute from './components/ProtectedRoute';
import LoginPage from './pages/LoginPage';
import HomePage from './pages/HomePage';
import NewEssayPage from './pages/NewEssayPage';
import EssayPage from './pages/EssayPage';
import ProgressPage from './pages/ProgressPage';
import SharingPage from './pages/SharingPage';
import ClipboardDebugPage from './pages/ClipboardDebugPage';

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<HomePage />} />
            <Route path="/new" element={<NewEssayPage />} />
            <Route path="/essay/:essayId" element={<EssayPage />} />
            <Route path="/essay/:essayId/overall" element={<EssayPage />} />
            <Route path="/essay/:essayId/transitions" element={<EssayPage />} />
            <Route path="/essay/:essayId/grammar" element={<EssayPage />} />
            <Route path="/essay/:essayId/prompt" element={<EssayPage />} />
            <Route path="/essay/:essayId/duplication" element={<EssayPage />} />
            <Route path="/essay/:essayId/revise" element={<EssayPage />} />
            <Route path="/progress" element={<ProgressPage />} />
            <Route path="/user/:ownerUid/essay/:essayId" element={<EssayPage />} />
            <Route path="/user/:ownerUid/essay/:essayId/overall" element={<EssayPage />} />
            <Route path="/user/:ownerUid/essay/:essayId/transitions" element={<EssayPage />} />
            <Route path="/user/:ownerUid/essay/:essayId/grammar" element={<EssayPage />} />
            <Route path="/user/:ownerUid/essay/:essayId/prompt" element={<EssayPage />} />
            <Route path="/user/:ownerUid/essay/:essayId/duplication" element={<EssayPage />} />
            <Route path="/user/:ownerUid/essay/:essayId/revise" element={<EssayPage />} />
            <Route path="/sharing" element={<SharingPage />} />
            <Route path="/debug/clipboard" element={<ClipboardDebugPage />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}
