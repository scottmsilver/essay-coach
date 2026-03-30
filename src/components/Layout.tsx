import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import AppHeader from './AppHeader';
import CoachDrawer from './CoachDrawer';
import { EssayHeaderProvider, useEssayHeaderContext } from '../hooks/useEssayHeaderContext';
import { NavbarProvider, useNavbarContext } from '../hooks/useNavbarContext';

export default function Layout() {
  return (
    <EssayHeaderProvider>
      <NavbarProvider>
        <LayoutInner />
      </NavbarProvider>
    </EssayHeaderProvider>
  );
}

function LayoutInner() {
  const essayContext = useEssayHeaderContext();
  const { state: navbar, toggle } = useNavbarContext();

  const hasDrawer = navbar && navbar.entity && navbar.presentation && navbar.editor && navbar.actions && navbar.meta;

  return (
    <AppShell
      header={{ height: 52 }}
      navbar={hasDrawer ? {
        width: 280,
        breakpoint: 'xs',
        collapsed: { desktop: !navbar.opened, mobile: true },
      } : undefined}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader essayContext={essayContext ?? undefined} />
      </AppShell.Header>

      {hasDrawer && (
        <AppShell.Navbar p="xs">
          <CoachDrawer
            entity={navbar.entity!}
            presentation={navbar.presentation!}
            editor={navbar.editor!}
            meta={navbar.meta!}
          />
        </AppShell.Navbar>
      )}

      {/* Pull tab to toggle drawer */}
      {hasDrawer && (
        <div
          className={`coach-pull-tab ${navbar.opened ? 'coach-pull-tab-open' : ''}`}
          onClick={toggle}
          title={navbar.opened ? 'Hide overview' : 'Show overview'}
        >
          <span className="coach-pull-tab-icon">{navbar.opened ? '‹' : '›'}</span>
        </div>
      )}

      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
