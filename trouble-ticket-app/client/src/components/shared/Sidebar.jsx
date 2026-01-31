import React from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import './Sidebar.css';

const Sidebar = () => {
  const { isAuthenticated, role, logout } = useAuth();
  const navigate = useNavigate();

  const handleLogout = () => {
    logout();
    navigate('/chat');
  };

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1 className="sidebar-title">IT Support</h1>
      </div>

      <nav className="sidebar-nav">
        <div className="nav-section">
          <span className="nav-section-title">Public</span>
          <NavLink to="/chat" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
            <span className="nav-icon">💬</span>
            <span>User Chat</span>
          </NavLink>
        </div>

        {!isAuthenticated ? (
          <div className="nav-section">
            <span className="nav-section-title">Staff</span>
            <NavLink to="/login" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              <span className="nav-icon">🔐</span>
              <span>Login</span>
            </NavLink>
          </div>
        ) : (
          <>
            <div className="nav-section">
              <span className="nav-section-title">Support</span>
              <NavLink to="/it-support" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                <span className="nav-icon">🎫</span>
                <span>Tickets</span>
              </NavLink>
            </div>

            {role === 'admin' && (
              <div className="nav-section">
                <span className="nav-section-title">Admin</span>
                <NavLink to="/admin/settings" className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
                  <span className="nav-icon">⚙️</span>
                  <span>Settings</span>
                </NavLink>
              </div>
            )}
          </>
        )}
      </nav>

      {isAuthenticated && (
        <div className="sidebar-footer">
          <div className="user-info">
            <span className="user-role">{role === 'admin' ? 'Administrator' : 'IT Support'}</span>
          </div>
          <button className="logout-btn" onClick={handleLogout}>
            Logout
          </button>
        </div>
      )}
    </aside>
  );
};

export default Sidebar;
