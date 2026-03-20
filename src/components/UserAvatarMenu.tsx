import { Menu, Avatar } from '@mantine/core';
import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function UserAvatarMenu() {
  const { user, logOut } = useAuth();
  const initial = (user?.displayName?.[0] ?? user?.email?.[0] ?? '?').toUpperCase();

  return (
    <Menu shadow="md" width={180} position="bottom-end">
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
        <Menu.Label>{user?.email}</Menu.Label>
        <Menu.Item component={Link} to="/progress">Progress</Menu.Item>
        <Menu.Item component={Link} to="/sharing">Sharing</Menu.Item>
        <Menu.Divider />
        <Menu.Item color="red" onClick={logOut}>Sign out</Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}
