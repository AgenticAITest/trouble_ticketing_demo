import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';

/**
 * Protected route wrapper
 * Redirects to login if not authenticated
 * Redirects to appropriate page if role doesn't match
 */
const ProtectedRoute = ({ children, requiredRole }) => {
  const { isAuthenticated, role, isLoading } = useAuth();

  // Show loading state while checking auth
  if (isLoading) {
    return (
      <div className="loading-container">
        <div className="spinner"></div>
        <p>Loading...</p>
      </div>
    );
  }

  // Redirect to login if not authenticated
  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Admin can access everything
  if (role === 'admin') {
    return children;
  }

  // IT Support can access IT pages but not admin pages
  if (requiredRole === 'admin' && role !== 'admin') {
    return <Navigate to="/it-support" replace />;
  }

  // IT Support trying to access IT Support pages is OK
  if (requiredRole === 'it_support' && (role === 'it_support' || role === 'admin')) {
    return children;
  }

  // Default: redirect to chat
  return <Navigate to="/chat" replace />;
};

export default ProtectedRoute;
