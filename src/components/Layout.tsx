import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { NAV_LINKS } from '../constants';

export default function Layout() {
  const { user, logOut } = useAuth();
  const { pathname } = useLocation();
  const isEssayRoute = /\/(essay|user\/[^/]+\/essay)\//.test(pathname);

  return (
    <div className="app">
      <nav className={`navbar ${isEssayRoute ? 'navbar-hidden' : ''}`}>
        <div className="nav-content">
          <div className="nav-brand">EssayCoach</div>
          <div className="nav-links">
            {NAV_LINKS.map(({ to, label }) => (
              <NavLink key={to} to={to}>{label}</NavLink>
            ))}
          </div>
          <div className="nav-user">
            {user?.photoURL && <img src={user.photoURL} alt="" className="avatar" />}
            <button onClick={logOut} className="sign-out-btn">Sign out</button>
          </div>
        </div>
      </nav>
      <main className="main-content">
        <Outlet />
      </main>
    </div>
  );
}
