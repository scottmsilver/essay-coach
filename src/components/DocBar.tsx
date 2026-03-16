import { useState, useRef, type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import HamburgerMenu from './HamburgerMenu';

interface DraftOption {
  id: string;
  label: string;
}

interface Props {
  title: string;
  activeDraftId?: string;
  draftLabel?: string;
  draftOptions?: DraftOption[];
  onPickDraft?: (id: string) => void;
  children?: ReactNode;
}

export default function DocBar({ title, activeDraftId, draftLabel, draftOptions, onPickDraft, children }: Props) {
  const { user, logOut } = useAuth();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useClickOutside<HTMLDivElement>(() => setPickerOpen(false), pickerOpen);

  return (
    <div className="doc-bar">
      <div className="doc-bar-left">
        <HamburgerMenu onSignOut={logOut} />
        <h2 className="doc-bar-title">{title}</h2>
        {draftLabel && (
          <div className="doc-bar-draft" ref={pickerRef}>
            <span className="doc-bar-draft-label">{draftLabel}</span>
            {draftOptions && draftOptions.length > 1 && (
              <>
                <button
                  className="doc-bar-draft-pick"
                  onClick={() => setPickerOpen(!pickerOpen)}
                  aria-label="Pick version"
                >
                  &#9662;
                </button>
                {pickerOpen && (
                  <div className="doc-bar-draft-menu">
                    {draftOptions.map((opt) => (
                      <button
                        key={opt.id}
                        className={`doc-bar-draft-item ${opt.id === activeDraftId ? 'active' : ''}`}
                        onClick={() => { onPickDraft?.(opt.id); setPickerOpen(false); }}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        )}
        {children}
      </div>
      <div className="doc-bar-right">
        {user?.photoURL ? (
          <img src={user.photoURL} alt="" className="doc-bar-avatar" title={user.email ?? ''} />
        ) : (
          <span className="doc-bar-avatar-fallback" title={user?.email ?? ''}>
            {user?.email?.[0]?.toUpperCase() ?? '?'}
          </span>
        )}
      </div>
    </div>
  );
}
