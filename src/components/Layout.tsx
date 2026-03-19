import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { AppShell, Burger, Group, Stack, Button } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { NAV_LINKS } from '../constants';
import UserAvatarMenu from './UserAvatarMenu';

export default function Layout() {
  const { pathname } = useLocation();
  const isEssayRoute = /\/(essay|user\/[^/]+\/essay)\//.test(pathname);
  const [opened, { toggle, close }] = useDisclosure(false);

  return (
    <AppShell
      header={{ height: isEssayRoute ? 0 : 56 }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { desktop: true, mobile: !opened },
      }}
      padding="md"
    >
      {!isEssayRoute && (
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="xs">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
              <Link to="/" className="brand-link">
                EssayCoach
              </Link>
            </Group>

            <Group gap={4} visibleFrom="sm">
              {NAV_LINKS.map(({ to, label }) => (
                <NavLink
                  key={to}
                  to={to}
                  end={to === '/'}
                  className={({ isActive }) =>
                    `nav-tab ${isActive ? 'nav-tab-active' : ''}`
                  }
                >
                  {label}
                </NavLink>
              ))}
            </Group>

            <Group gap="sm">
              <Button component={Link} to="/new" size="compact-sm" visibleFrom="sm">
                + New Essay
              </Button>
              <UserAvatarMenu />
            </Group>
          </Group>
        </AppShell.Header>
      )}

      <AppShell.Navbar p="md">
        <Stack gap={4}>
          {NAV_LINKS.map(({ to, label }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                `nav-tab-mobile ${isActive ? 'nav-tab-mobile-active' : ''}`
              }
              onClick={close}
            >
              {label}
            </NavLink>
          ))}
          <Link to="/new" className="nav-tab-mobile" onClick={close}>
            + New Essay
          </Link>
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
