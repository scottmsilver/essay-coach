import { type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@mantine/core';
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
  onOpenSettings?: () => void;
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

function EssayHeader({ title, draftLabel, onOpenSettings }: EssayHeaderContext) {
  return (
    <div className="app-header app-header-essay app-header-essay-single">
      <Link to="/" className="app-header-brand">EssayCoach</Link>
      <span className="app-header-sep">&rsaquo;</span>
      <span className="app-header-title">{title}</span>
      {onOpenSettings && (
        <button className="app-header-settings-btn" onClick={onOpenSettings} title="Essay settings">
          ⚙
        </button>
      )}
      <span className="app-header-draft-label">{draftLabel}</span>
      <div style={{ marginLeft: 'auto' }}>
        <UserAvatarMenu />
      </div>
    </div>
  );
}
