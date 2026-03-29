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

  return (
    <AppShell
      header={{ height: 52 }}
      navbar={navbar ? {
        width: 280,
        breakpoint: 'xs',
        collapsed: { desktop: !navbar.opened, mobile: true },
      } : undefined}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader essayContext={essayContext ?? undefined} />
      </AppShell.Header>

      {navbar && (
        <AppShell.Navbar p="xs">
          <CoachDrawer {...navbar.drawerProps} />
        </AppShell.Navbar>
      )}

      {/* Pull tab to toggle drawer */}
      {navbar && (
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
