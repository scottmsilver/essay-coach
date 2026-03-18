import { NavLink, Outlet, useLocation, Link } from 'react-router-dom';
import { AppShell, Burger, Group, Avatar, Menu, Stack } from '@mantine/core';
import { useDisclosure } from '@mantine/hooks';
import { useAuth } from '../hooks/useAuth';
import { NAV_LINKS } from '../constants';

export default function Layout() {
  const { user, logOut } = useAuth();
  const { pathname } = useLocation();
  const isEssayRoute = /\/(essay|user\/[^/]+\/essay)\//.test(pathname);
  const [opened, { toggle, close }] = useDisclosure(false);

  const initial = (user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  return (
    <AppShell
      header={{ height: isEssayRoute ? 0 : 56 }}
      navbar={{
        width: 260,
        breakpoint: 'sm',
        collapsed: { desktop: true, mobile: !opened },
      }}
      padding={0}
    >
      {!isEssayRoute && (
        <AppShell.Header>
          <Group h="100%" px="md" justify="space-between">
            <Group gap="xs">
              <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
              <Link to="/" style={{ textDecoration: 'none', color: 'var(--color-primary)', fontWeight: 700, fontSize: 18 }}>
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

            <Menu shadow="md" width={160} position="bottom-end">
              <Menu.Target>
                <Avatar
                  src={user?.photoURL}
                  alt={user?.displayName ?? ''}
                  radius="xl"
                  size="sm"
                  style={{ cursor: 'pointer' }}
                >
                  {initial}
                </Avatar>
              </Menu.Target>
              <Menu.Dropdown>
                <Menu.Item onClick={logOut}>Sign out</Menu.Item>
              </Menu.Dropdown>
            </Menu>
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
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main className="main-content">
        <Outlet />
      </AppShell.Main>
    </AppShell>
  );
}
