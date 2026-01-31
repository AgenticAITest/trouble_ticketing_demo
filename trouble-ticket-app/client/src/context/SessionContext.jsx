import React, { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { chatApi } from '../services/api';

const SessionContext = createContext(null);

const SESSIONS_STORAGE_KEY = 'chat_sessions';
const ACTIVE_SESSION_KEY = 'active_session_id';

/**
 * Generate a unique session ID
 */
function generateSessionId() {
  return 'sess_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
}

/**
 * Load sessions from localStorage
 */
function loadSessions() {
  try {
    const stored = localStorage.getItem(SESSIONS_STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * Save sessions to localStorage
 */
function saveSessions(sessions) {
  localStorage.setItem(SESSIONS_STORAGE_KEY, JSON.stringify(sessions));
}

/**
 * Session provider component
 * Manages multiple chat sessions with notifications
 */
export function SessionProvider({ children }) {
  const [sessions, setSessions] = useState(() => loadSessions());
  const [activeSessionId, setActiveSessionId] = useState(() => {
    const stored = localStorage.getItem(ACTIVE_SESSION_KEY);
    if (stored && loadSessions().find(s => s.id === stored)) {
      return stored;
    }
    return null;
  });
  const [notifications, setNotifications] = useState({}); // { sessionId: count }

  // Create initial session if none exist
  useEffect(() => {
    if (sessions.length === 0) {
      createNewSession();
    } else if (!activeSessionId) {
      // Set first session as active if none selected
      const firstSession = sessions[0];
      setActiveSessionId(firstSession.id);
      localStorage.setItem(ACTIVE_SESSION_KEY, firstSession.id);
    }
  }, []);

  // Save sessions whenever they change
  useEffect(() => {
    saveSessions(sessions);
  }, [sessions]);

  // Poll for notifications across all sessions
  useEffect(() => {
    const checkAllNotifications = async () => {
      const newNotifications = {};
      for (const session of sessions) {
        try {
          const result = await chatApi.checkNotifications(session.id);
          if (result.count > 0) {
            newNotifications[session.id] = result.count;
          }
        } catch (error) {
          // Ignore errors for individual sessions
        }
      }
      setNotifications(newNotifications);
    };

    checkAllNotifications();
    const interval = setInterval(checkAllNotifications, 10000);
    return () => clearInterval(interval);
  }, [sessions]);

  /**
   * Create a new session
   */
  const createNewSession = useCallback(() => {
    const newId = generateSessionId();
    const newSession = {
      id: newId,
      createdAt: new Date().toISOString(),
      preview: 'New conversation',
      application: null,
      lastMessageAt: new Date().toISOString()
    };

    setSessions(prev => [newSession, ...prev]);
    setActiveSessionId(newId);
    localStorage.setItem(ACTIVE_SESSION_KEY, newId);
    return newId;
  }, []);

  /**
   * Switch to a different session
   */
  const switchSession = useCallback((sessionId) => {
    const session = sessions.find(s => s.id === sessionId);
    if (session) {
      setActiveSessionId(sessionId);
      localStorage.setItem(ACTIVE_SESSION_KEY, sessionId);

      // Clear notification for this session
      if (notifications[sessionId]) {
        chatApi.markAsRead(sessionId).catch(() => {});
        setNotifications(prev => {
          const updated = { ...prev };
          delete updated[sessionId];
          return updated;
        });
      }
    }
  }, [sessions, notifications]);

  /**
   * Update session metadata (preview, application)
   */
  const updateSession = useCallback((sessionId, updates) => {
    setSessions(prev => prev.map(session => {
      if (session.id === sessionId) {
        return {
          ...session,
          ...updates,
          lastMessageAt: new Date().toISOString()
        };
      }
      return session;
    }));
  }, []);

  /**
   * Delete a session
   */
  const deleteSession = useCallback((sessionId) => {
    setSessions(prev => {
      const filtered = prev.filter(s => s.id !== sessionId);

      // If deleting active session, switch to another
      if (activeSessionId === sessionId && filtered.length > 0) {
        const newActive = filtered[0].id;
        setActiveSessionId(newActive);
        localStorage.setItem(ACTIVE_SESSION_KEY, newActive);
      } else if (filtered.length === 0) {
        // Create new session if all deleted
        setTimeout(() => createNewSession(), 0);
      }

      return filtered;
    });
  }, [activeSessionId, createNewSession]);

  /**
   * Get total notification count across all sessions
   */
  const totalNotifications = Object.values(notifications).reduce((sum, count) => sum + count, 0);

  /**
   * Get session with notification (for jumping to it)
   */
  const getSessionWithNotification = useCallback(() => {
    const sessionId = Object.keys(notifications)[0];
    return sessionId || null;
  }, [notifications]);

  /**
   * Mark a specific session as read (clears notifications)
   * Use this when user is actively viewing a session
   */
  const markSessionAsRead = useCallback((sessionId) => {
    if (notifications[sessionId]) {
      chatApi.markAsRead(sessionId).catch(() => {});
      setNotifications(prev => {
        const updated = { ...prev };
        delete updated[sessionId];
        return updated;
      });
    }
  }, [notifications]);

  const value = {
    // Current session
    sessionId: activeSessionId,

    // All sessions
    sessions,

    // Notifications
    notifications,
    totalNotifications,
    hasNotifications: totalNotifications > 0,

    // Actions
    newSession: createNewSession,
    switchSession,
    updateSession,
    deleteSession,
    getSessionWithNotification,
    markSessionAsRead
  };

  return (
    <SessionContext.Provider value={value}>
      {children}
    </SessionContext.Provider>
  );
}

/**
 * Hook to access session context
 */
export function useSession() {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
}
