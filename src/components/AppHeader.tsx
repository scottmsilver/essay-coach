import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mantine/core';
import { useClickOutside } from '../hooks/useClickOutside';
import UserAvatarMenu from './UserAvatarMenu';

interface DraftOption {
  id: string;
  label: string;
}

export interface EssayHeaderContext {
  title: string;
  draftLabel: string;
  activeDraftId?: string;
  draftOptions?: DraftOption[];
  onPickDraft?: (id: string) => void;
  toolbar?: ReactNode;
}

interface Props {
  essayContext?: EssayHeaderContext;
}

export default function AppHeader({ essayContext }: Props) {
  if (essayContext) {
    return <EssayHeader {...essayContext} />;
  }

  return (
    <div className="app-header app-header-home">
      <Link to="/" className="app-header-brand">EssayCoach</Link>
      <div className="app-header-right">
        <Button component={Link} to="/new" size="compact-sm">
          + New Essay
        </Button>
        <UserAvatarMenu />
      </div>
    </div>
  );
}

function EssayHeader({ title, draftLabel, activeDraftId, draftOptions, onPickDraft, toolbar }: EssayHeaderContext) {
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useClickOutside<HTMLDivElement>(() => setPickerOpen(false), pickerOpen);

  return (
    <div className="app-header app-header-essay">
      <div className="app-header-essay-rows">
        <div className="app-header-row1">
          <Link to="/" className="app-header-brand">EssayCoach</Link>
          <span className="app-header-sep">&rsaquo;</span>
          <span className="app-header-title">{title}</span>
          <div className="app-header-draft" ref={pickerRef}>
            <span className="app-header-draft-label">{draftLabel}</span>
            {draftOptions && draftOptions.length > 1 && (
              <>
                <button
                  className="app-header-draft-pick"
                  onClick={() => setPickerOpen(!pickerOpen)}
                  aria-label="Pick version"
                >
                  &#9662;
                </button>
                {pickerOpen && (
                  <div className="draft-picker-menu">
                    {draftOptions.map((opt) => (
                      <button
                        key={opt.id}
                        className={`draft-picker-item ${opt.id === activeDraftId ? 'active' : ''}`}
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
        </div>
        <div className="app-header-row2">
          {toolbar}
        </div>
      </div>
      <div className="app-header-avatar-col">
        <UserAvatarMenu />
      </div>
    </div>
  );
}
