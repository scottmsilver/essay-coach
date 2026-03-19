import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Burger, Drawer, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useAuth } from '../hooks/useAuth';
import { useClickOutside } from '../hooks/useClickOutside';
import { NAV_LINKS } from '../constants';
import UserAvatarMenu from './UserAvatarMenu';

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
  const { logOut } = useAuth();
  const navigate = useNavigate();
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useClickOutside<HTMLDivElement>(() => setPickerOpen(false), pickerOpen);
  const [drawerOpened, { open: openDrawer, close: closeDrawer }] = useDisclosure(false);

  return (
    <>
      <Drawer opened={drawerOpened} onClose={closeDrawer} size="xs" title="EssayCoach">
        <Stack gap={4}>
          {NAV_LINKS.map(({ to, label }) => (
            <Link key={to} to={to} className="nav-tab-mobile" onClick={closeDrawer}>
              {label}
            </Link>
          ))}
          <div style={{ height: 1, background: 'var(--color-border)', margin: '8px 0' }} />
          <button className="nav-tab-mobile" onClick={() => { closeDrawer(); logOut(); }}>
            Sign out
          </button>
        </Stack>
      </Drawer>

      <div className="doc-bar">
        <div className="doc-bar-left">
          <button className="doc-bar-home" onClick={() => navigate('/')} title="Back to My Essays">
            EC
          </button>
          <span className="doc-bar-title">{title}</span>
          {draftLabel && (
            <div className="doc-bar-draft" ref={pickerRef}>
              <span className="doc-bar-draft-label">&middot; {draftLabel}</span>
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
        </div>
        <div className="doc-bar-right">
          {children}
          <Burger opened={drawerOpened} onClick={openDrawer} size="xs" hiddenFrom="sm" />
          <UserAvatarMenu />
        </div>
      </div>
    </>
  );
}
