import { Menu, Avatar } from '@mantine/core';
import { useAuth } from '../hooks/useAuth';

export default function UserAvatarMenu() {
  const { user, logOut } = useAuth();
  const initial = (user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  return (
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
  );
}
