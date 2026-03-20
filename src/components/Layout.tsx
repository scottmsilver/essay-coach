import { Outlet } from 'react-router-dom';
import { AppShell } from '@mantine/core';
import AppHeader from './AppHeader';
import { EssayHeaderProvider, useEssayHeaderContext } from '../hooks/useEssayHeaderContext';

export default function Layout() {
  return (
    <EssayHeaderProvider>
      <LayoutInner />
    </EssayHeaderProvider>
  );
}

function LayoutInner() {
  const essayContext = useEssayHeaderContext();

  return (
    <AppShell
      header={{ height: essayContext ? 105 : 52 }}
      padding="md"
    >
      <AppShell.Header>
        <AppHeader essayContext={essayContext ?? undefined} />
      </AppShell.Header>

      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
