import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

export default function Layout() {
  const { user, logOut } = useAuth();

  return (
    <div className="app">
      <nav className="navbar">
        <div className="nav-content">
          <div className="nav-brand">EssayCoach</div>
          <div className="nav-links">
            <NavLink to="/new">New Essay</NavLink>
            <NavLink to="/">My Essays</NavLink>
            <NavLink to="/progress">Progress</NavLink>
            <NavLink to="/sharing">Sharing</NavLink>
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
