import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useClickOutside } from '../hooks/useClickOutside';
import { NAV_LINKS } from '../constants';

interface Props {
  onSignOut: () => void;
}

export default function HamburgerMenu({ onSignOut }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  return (
    <div style={{ position: 'relative' }} ref={ref}>
      <button className="hamburger-btn" onClick={() => setOpen(!open)}>
        &#9776;
      </button>
      {open && (
        <div className="hamburger-menu">
          {NAV_LINKS.map(({ to, label }) => (
            <Link key={to} to={to} className="hamburger-item" onClick={() => setOpen(false)}>
              {label}
            </Link>
          ))}
          <div className="hamburger-divider" />
          <button className="hamburger-item" onClick={() => { setOpen(false); onSignOut(); }}>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}
