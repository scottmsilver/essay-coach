import { useState } from 'react';
import { httpsCallable } from 'firebase/functions';
import { Button, TextInput } from '@mantine/core';
import { functions } from '../firebase';
import { useMyShares } from '../hooks/useMyShares';
import { useSharedWithMe } from '../hooks/useSharedWithMe';

export default function SharingPage() {
  const { shares: myShares, loading: mySharesLoading } = useMyShares();
  const { shares: sharedWithMe, loading: sharedWithMeLoading } = useSharedWithMe();
  const [email, setEmail] = useState('');
  const [sharing, setSharing] = useState(false);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const handleShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSharing(true);
    setMessage(null);
    try {
      const shareEssays = httpsCallable(functions, 'shareEssays');
      await shareEssays({ email: email.trim() });
      setMessage({ type: 'success', text: `Shared with ${email.trim()}` });
      setEmail('');
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to share';
      setMessage({ type: 'error', text: msg });
    } finally {
      setSharing(false);
    }
  };

  const handleUnshare = async (recipientEmail: string) => {
    try {
      const unshareEssays = httpsCallable(functions, 'unshareEssays');
      await unshareEssays({ email: recipientEmail });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove share';
      setMessage({ type: 'error', text: msg });
    }
  };

  const handleRemoveSharedWithMe = async (ownerUid: string) => {
    try {
      const removeShared = httpsCallable(functions, 'removeSharedWithMe');
      await removeShared({ ownerUid });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Failed to remove';
      setMessage({ type: 'error', text: msg });
    }
  };

  const loading = mySharesLoading || sharedWithMeLoading;
  if (loading) return <div className="loading-state"><div className="spinner" /><p>Loading...</p></div>;

  return (
    <div>
      <h2>Sharing</h2>

      {/* Share my essays */}
      <section style={{ marginBottom: 32 }}>
        <h3>Share My Essays</h3>
        <form onSubmit={handleShare} style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'flex-end' }}>
          <TextInput
            type="email"
            placeholder="Enter email address"
            value={email}
            onChange={(e) => setEmail(e.currentTarget.value)}
            style={{ flex: 1 }}
            disabled={sharing}
          />
          <Button type="submit" disabled={sharing || !email.trim()} loading={sharing}>
            Share
          </Button>
        </form>

        {message && (
          <div className={message.type === 'success' ? 'success-state' : 'error-state'} style={{ marginBottom: 16 }}>
            {message.text}
          </div>
        )}

        {myShares.length > 0 ? (
          <ul className="essay-list">
            {myShares.map((share) => (
              <li key={share.sharedWithUid ?? share.sharedWithEmail} className="essay-list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>
                  {share.sharedWithEmail}
                  {share.pending && <span style={{ color: 'var(--color-text-secondary)', fontSize: 13, marginLeft: 8 }}>(pending sign-up)</span>}
                </span>
                <Button
                  size="compact-sm"
                  variant="default"
                  onClick={() => handleUnshare(share.sharedWithEmail)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--color-text-secondary)' }}>You haven't shared your essays with anyone yet.</p>
        )}
      </section>

      {/* Shared with me */}
      <section>
        <h3>Shared With Me</h3>
        {sharedWithMe.length > 0 ? (
          <ul className="essay-list">
            {sharedWithMe.map((share) => (
              <li key={share.ownerUid} className="essay-list-item" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span>{share.ownerEmail}</span>
                <Button
                  size="compact-sm"
                  variant="default"
                  onClick={() => handleRemoveSharedWithMe(share.ownerUid)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p style={{ color: 'var(--color-text-secondary)' }}>No one has shared their essays with you.</p>
        )}
      </section>
    </div>
  );
}
