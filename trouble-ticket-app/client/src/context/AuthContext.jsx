import React, { createContext, useContext, useState, useEffect } from 'react';

const AuthContext = createContext(null);

/**
 * Auth provider component
 * Manages authentication state for IT Support and Admin roles
 */
export function AuthProvider({ children }) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [role, setRole] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  // Check for existing auth on mount
  useEffect(() => {
    const credentials = localStorage.getItem('auth_credentials');
    const storedRole = localStorage.getItem('auth_role');

    if (credentials && storedRole) {
      setIsAuthenticated(true);
      setRole(storedRole);
    }

    setIsLoading(false);
  }, []);

  /**
   * Login with role and password
   */
  const login = async (userRole, password) => {
    const credentials = btoa(`${userRole}:${password}`);

    // Test credentials by hitting a protected endpoint
    try {
      const response = await fetch('/api/settings', {
        headers: { Authorization: `Basic ${credentials}` }
      });

      if (response.ok) {
        localStorage.setItem('auth_credentials', credentials);
        localStorage.setItem('auth_role', userRole);
        setIsAuthenticated(true);
        setRole(userRole);
        return { success: true };
      } else if (response.status === 401 || response.status === 403) {
        return { success: false, error: 'Invalid credentials' };
      } else {
        return { success: false, error: 'Server error' };
      }
    } catch (error) {
      return { success: false, error: 'Network error' };
    }
  };

  /**
   * Logout and clear credentials
   */
  const logout = () => {
    localStorage.removeItem('auth_credentials');
    localStorage.removeItem('auth_role');
    setIsAuthenticated(false);
    setRole(null);
  };

  /**
   * Get auth headers for API requests
   */
  const getAuthHeaders = () => {
    const credentials = localStorage.getItem('auth_credentials');
    if (!credentials) return {};
    return { Authorization: `Basic ${credentials}` };
  };

  const value = {
    isAuthenticated,
    role,
    isLoading,
    login,
    logout,
    getAuthHeaders
  };

  return (
    <AuthContext.Provider value={value}>
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Hook to access auth context
 */
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
