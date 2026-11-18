import { Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';

/**
 * Top navigation bar displaying application brand, active user email, and logout action.
 */
export default function Navbar() {
  const { user, logout } = useAuth();

  return (
    <nav className="navbar" aria-label="Main Navigation">
      <div className="navbar-container">
        <Link to="/" className="navbar-brand">
          <span>AI Task Processing Platform</span>
        </Link>

        <div className="navbar-user-actions">
          {user?.email && (
            <span className="navbar-user-email" title="Authenticated User">
              {user.email}
            </span>
          )}

          <button
            type="button"
            className="btn-secondary navbar-logout-btn"
            onClick={logout}
          >
            Sign out
          </button>
        </div>
      </div>
    </nav>
  );
}
