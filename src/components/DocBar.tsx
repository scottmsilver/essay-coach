import type { ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import HamburgerMenu from './HamburgerMenu';

interface Props {
  title: string;
  children?: ReactNode;
}

export default function DocBar({ title, children }: Props) {
  const { user, logOut } = useAuth();

  return (
    <div className="doc-bar">
      <div className="doc-bar-left">
        <HamburgerMenu onSignOut={logOut} />
        <h2 className="doc-bar-title">{title}</h2>
        {children}
      </div>
      <div className="doc-bar-right">
        <span className="doc-bar-user">{user?.email}</span>
      </div>
    </div>
  );
}
