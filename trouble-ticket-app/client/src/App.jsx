import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import { AuthProvider } from './context/AuthContext';
import Sidebar from './components/shared/Sidebar';
import ProtectedRoute from './components/shared/ProtectedRoute';
import UserChat from './pages/UserChat';
import Login from './pages/Login';
import ITSupport from './pages/ITSupport';
import AdminSettings from './pages/AdminSettings';

const App = () => {
  return (
    <AuthProvider>
      <SessionProvider>
        <BrowserRouter>
          <div className="app-container">
            <Sidebar />
            <main className="main-content">
              <Routes>
                {/* Public routes */}
                <Route path="/" element={<Navigate to="/chat" />} />
                <Route path="/chat" element={<UserChat />} />
                <Route path="/login" element={<Login />} />

                {/* Protected routes */}
                <Route
                  path="/it-support"
                  element={
                    <ProtectedRoute requiredRole="it_support">
                      <ITSupport />
                    </ProtectedRoute>
                  }
                />
                <Route
                  path="/admin/settings"
                  element={
                    <ProtectedRoute requiredRole="admin">
                      <AdminSettings />
                    </ProtectedRoute>
                  }
                />
              </Routes>
            </main>
          </div>
        </BrowserRouter>
      </SessionProvider>
    </AuthProvider>
  );
};

export default App;
