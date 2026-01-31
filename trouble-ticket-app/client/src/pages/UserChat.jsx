import React, { useState, useEffect, useRef } from 'react';
import { useSession } from '../context/SessionContext';
import { chatApi } from '../services/api';
import './UserChat.css';

// Conversation starters for empty chat
const CONVERSATION_STARTERS = [
  { icon: '📍', text: "My Attendance app won't find my location" },
  { icon: '📦', text: "Delivery status hasn't updated" },
  { icon: '📷', text: "App crashes when I scan barcodes" },
  { icon: '🔐', text: "I can't log into the app" }
];

const UserChat = () => {
  const {
    sessionId,
    sessions,
    notifications,
    totalNotifications,
    hasNotifications,
    newSession,
    switchSession,
    updateSession,
    deleteSession,
    getSessionWithNotification,
    markSessionAsRead
  } = useSession();

  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const messagesEndRef = useRef(null);

  // Scroll to bottom when messages change
  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  // Load existing messages when session changes
  useEffect(() => {
    if (!sessionId) return;

    const loadMessages = async () => {
      try {
        const history = await chatApi.getSession(sessionId);
        setMessages(history);
        // Mark messages as read when viewing this session
        markSessionAsRead(sessionId);
      } catch (error) {
        console.error('Failed to load messages:', error);
        setMessages([]);
      }
    };
    loadMessages();
  }, [sessionId, markSessionAsRead]);

  const handleSend = async () => {
    if (!inputValue.trim() || isLoading || !sessionId) return;

    const userMessage = { sender: 'user', content: inputValue, timestamp: new Date().toISOString() };
    setMessages(prev => [...prev, userMessage]);
    const sentMessage = inputValue;
    setInputValue('');
    setIsLoading(true);

    try {
      const response = await chatApi.sendMessage(sessionId, sentMessage);
      const aiMessage = {
        sender: 'ai',
        content: response.response,
        timestamp: new Date().toISOString(),
        ticket: response.ticket || null,
        status: response.status || null
      };
      setMessages(prev => [...prev, aiMessage]);

      // Update session preview and application
      updateSession(sessionId, {
        preview: sentMessage.substring(0, 50) + (sentMessage.length > 50 ? '...' : ''),
        application: response.application || null
      });

      // Clear any notifications for this session since user is actively chatting
      markSessionAsRead(sessionId);
    } catch (error) {
      setMessages(prev => [...prev, {
        sender: 'ai',
        content: 'Sorry, something went wrong. Please try again.',
        timestamp: new Date().toISOString()
      }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNotificationClick = () => {
    // Find session with notification and switch to it
    const notifSessionId = getSessionWithNotification();
    if (notifSessionId) {
      switchSession(notifSessionId);
      setShowSidebar(false);
    }
  };

  const handleExport = async () => {
    if (messages.length === 0) return;
    try {
      await chatApi.exportTranscript(sessionId);
    } catch (error) {
      console.error('Failed to export:', error);
    }
  };

  const handleStarterClick = (text) => {
    setInputValue(text);
  };

  const handleNewChat = () => {
    newSession();
    setMessages([]);
    setShowSidebar(false);
  };

  const handleSessionSelect = (id) => {
    switchSession(id);
    setShowSidebar(false);
  };

  const handleDeleteSession = (e, id) => {
    e.stopPropagation();
    if (confirm('Delete this conversation?')) {
      deleteSession(id);
      if (id === sessionId) {
        setMessages([]);
      }
    }
  };

  const formatSessionDate = (dateStr) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (days === 1) {
      return 'Yesterday';
    } else if (days < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  return (
    <div className="user-chat-layout">
      {/* Session Sidebar */}
      <aside className={`session-sidebar ${showSidebar ? 'open' : ''}`}>
        <div className="sidebar-header">
          <h2>Conversations</h2>
          <button className="sidebar-close" onClick={() => setShowSidebar(false)}>×</button>
        </div>
        <button className="new-chat-btn" onClick={handleNewChat}>
          + New Conversation
        </button>
        <div className="session-list">
          {sessions.map(session => (
            <div
              key={session.id}
              className={`session-item ${session.id === sessionId ? 'active' : ''} ${notifications[session.id] ? 'has-notification' : ''}`}
              onClick={() => handleSessionSelect(session.id)}
            >
              <div className="session-info">
                <div className="session-preview">
                  {session.application && (
                    <span className="session-app-tag">{session.application}</span>
                  )}
                  {session.preview}
                </div>
                <div className="session-meta">
                  <span className="session-date">{formatSessionDate(session.lastMessageAt || session.createdAt)}</span>
                  {notifications[session.id] && (
                    <span className="session-notif-badge">{notifications[session.id]}</span>
                  )}
                </div>
              </div>
              <button
                className="session-delete"
                onClick={(e) => handleDeleteSession(e, session.id)}
                title="Delete conversation"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>

      {/* Sidebar Overlay */}
      {showSidebar && <div className="sidebar-overlay" onClick={() => setShowSidebar(false)} />}

      {/* Main Chat Area */}
      <div className="user-chat-container">
        <header className="chat-header">
          <div className="header-left">
            <button className="menu-btn" onClick={() => setShowSidebar(true)} title="Show conversations">
              ☰
            </button>
            <h1>IT Support Assistant</h1>
          </div>
          <div className="header-actions">
            {messages.length > 0 && (
              <button className="header-btn" onClick={handleExport} title="Export chat">
                📥 Export
              </button>
            )}
            <button className="header-btn" onClick={handleNewChat} title="New chat">
              ➕ New
            </button>
            <button
              className={`notification-btn ${hasNotifications ? 'has-notification' : ''}`}
              onClick={handleNotificationClick}
              title="Notifications from IT Support"
            >
              🔔
              {totalNotifications > 0 && (
                <span className="notification-badge">{totalNotifications}</span>
              )}
            </button>
          </div>
        </header>

        <div className="chat-window">
          {messages.length === 0 ? (
            <div className="conversation-starters">
              <p className="starters-title">How can I help you today?</p>
              <div className="starter-buttons">
                {CONVERSATION_STARTERS.map((starter, index) => (
                  <button
                    key={index}
                    className="starter-btn"
                    onClick={() => handleStarterClick(starter.text)}
                  >
                    <span className="starter-icon">{starter.icon}</span>
                    <span className="starter-text">{starter.text}</span>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="messages-container">
              {messages.map((msg, index) => (
                <div key={index} className={`message-bubble ${msg.sender}`}>
                  <div className="message-content">{msg.content}</div>
                  {msg.ticket && (
                    <div className="ticket-badge">
                      🎫 Ticket {msg.ticket.ticket_id} created
                    </div>
                  )}
                  <div className="message-time">
                    {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              ))}
              {isLoading && (
                <div className="message-bubble ai">
                  <div className="typing-indicator">
                    <span></span>
                    <span></span>
                    <span></span>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>
          )}
        </div>

        <div className="input-area">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Describe your issue..."
            disabled={isLoading}
          />
          <button className="btn-primary" onClick={handleSend} disabled={isLoading || !inputValue.trim()}>
            Send
          </button>
        </div>
      </div>
    </div>
  );
};

export default UserChat;
