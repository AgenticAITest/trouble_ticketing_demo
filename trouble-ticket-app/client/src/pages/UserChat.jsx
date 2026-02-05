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
  const [pageViewer, setPageViewer] = useState(null); // { docId, pageNumber, pageUrl, isLoading }
  const [selectedImage, setSelectedImage] = useState(null); // { file, preview }
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const messagesEndRef = useRef(null);
  const imageInputRef = useRef(null);

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
        // Map image_url to image for display consistency
        const mappedHistory = history.map(msg => ({
          ...msg,
          image: msg.image_url || null
        }));
        setMessages(mappedHistory);
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
    if ((!inputValue.trim() && !selectedImage) || isLoading || !sessionId) return;

    // Build user message content
    const userMessageContent = inputValue.trim() || (selectedImage ? 'Please help me with this screenshot.' : '');
    const userMessage = {
      sender: 'user',
      content: userMessageContent,
      timestamp: new Date().toISOString(),
      image: selectedImage ? selectedImage.preview : null
    };
    setMessages(prev => [...prev, userMessage]);
    const sentMessage = userMessageContent;
    const imageToSend = selectedImage;
    setInputValue('');
    setSelectedImage(null);
    setIsLoading(true);

    try {
      let imageId = null;

      // Upload image first if present
      if (imageToSend) {
        setIsUploadingImage(true);
        try {
          const uploadResult = await chatApi.uploadImage(imageToSend.file);
          imageId = uploadResult.imageId;
        } catch (uploadError) {
          console.error('Image upload failed:', uploadError);
          setMessages(prev => [...prev, {
            sender: 'ai',
            content: 'Sorry, I couldn\'t upload your image. Please try again.',
            timestamp: new Date().toISOString()
          }]);
          setIsLoading(false);
          setIsUploadingImage(false);
          return;
        }
        setIsUploadingImage(false);
      }

      const response = await chatApi.sendMessage(sessionId, sentMessage, imageId);

      // Update the user message with the persisted image URL (replacing blob URL)
      if (response.savedImageUrl && imageToSend) {
        setMessages(prev => prev.map((msg, idx) => {
          // Find the user message we just added (second to last, before AI response)
          if (idx === prev.length - 1 && msg.sender === 'user' && msg.image) {
            // Revoke the temporary blob URL
            URL.revokeObjectURL(msg.image);
            return { ...msg, image: response.savedImageUrl };
          }
          return msg;
        }));
      }

      const aiMessage = {
        sender: 'ai',
        content: response.response,
        timestamp: new Date().toISOString(),
        ticket: response.ticket || null,
        status: response.status || null,
        relatedPages: response.relatedPages || null
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
      setIsUploadingImage(false);
    }
  };

  // Handle image selection
  const handleImageSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('Image size must be less than 5MB');
        return;
      }
      const preview = URL.createObjectURL(file);
      setSelectedImage({ file, preview });
    }
    // Reset file input
    if (imageInputRef.current) {
      imageInputRef.current.value = '';
    }
  };

  // Remove selected image
  const handleRemoveImage = () => {
    if (selectedImage?.preview) {
      URL.revokeObjectURL(selectedImage.preview);
    }
    setSelectedImage(null);
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

  // Open page viewer modal
  const handleViewPage = (page) => {
    setPageViewer({
      docId: page.docId,
      pageNumber: page.pageNumber,
      pageUrl: page.pageUrl,
      application: page.application,
      isLoading: true
    });
  };

  // Close page viewer modal
  const handleClosePageViewer = () => {
    setPageViewer(null);
  };

  // Handle Escape key to close modal
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && pageViewer) {
        handleClosePageViewer();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [pageViewer]);

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
                  {msg.image && (
                    <div className="message-image">
                      <img src={msg.image} alt="Attached screenshot" />
                    </div>
                  )}
                  <div className="message-content">{msg.content}</div>
                  {msg.relatedPages && msg.relatedPages.length > 0 && (
                    <div className="related-pages">
                      <div className="related-pages-header">Related Documentation:</div>
                      {/* Show PDF page thumbnails inline */}
                      <div className="related-pages-thumbnails">
                        {msg.relatedPages.slice(0, 3).filter(page => page.pageNumber && page.docId).map((page, pageIdx) => (
                          <div
                            key={pageIdx}
                            className="page-thumbnail-container"
                            onClick={() => handleViewPage(page)}
                            title={`Click to enlarge - Page ${page.pageNumber}${page.application ? ` from ${page.application}` : ''}`}
                          >
                            <img
                              src={`/api/documents/${page.docId}/page/${page.pageNumber}`}
                              alt={`Page ${page.pageNumber}`}
                              className="page-thumbnail"
                              loading="lazy"
                            />
                            <div className="page-thumbnail-label">
                              Page {page.pageNumber}
                              {page.application && <span className="page-app">{page.application}</span>}
                            </div>
                          </div>
                        ))}
                      </div>
                      {/* Show markdown sections as buttons */}
                      <div className="related-pages-list">
                        {msg.relatedPages.slice(0, 3).filter(page => !page.pageNumber && page.header).map((page, pageIdx) => (
                          <button
                            key={pageIdx}
                            className="view-page-btn markdown-section"
                            disabled
                            style={{ cursor: 'default' }}
                            title={`Section: ${page.header}`}
                          >
                            <span className="page-icon">📝</span>
                            <span className="page-info">
                              <span className="page-number">Section: {page.header}</span>
                              {page.application && (
                                <span className="page-source">{page.application}</span>
                              )}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
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
          {/* Hidden file input for image upload */}
          <input
            type="file"
            ref={imageInputRef}
            accept="image/jpeg,image/png,image/gif,image/webp"
            onChange={handleImageSelect}
            style={{ display: 'none' }}
          />

          {/* Image preview */}
          {selectedImage && (
            <div className="image-preview">
              <img src={selectedImage.preview} alt="Selected" />
              <button className="remove-image-btn" onClick={handleRemoveImage} title="Remove image">
                ×
              </button>
            </div>
          )}

          <div className="input-row">
            <button
              className="image-upload-btn"
              onClick={() => imageInputRef.current?.click()}
              disabled={isLoading}
              title="Attach screenshot"
            >
              📷
            </button>
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleSend()}
              placeholder={selectedImage ? "Add a message about your screenshot..." : "Describe your issue..."}
              disabled={isLoading}
            />
            <button
              className="btn-primary"
              onClick={handleSend}
              disabled={isLoading || (!inputValue.trim() && !selectedImage)}
            >
              {isUploadingImage ? '...' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      {/* Page Viewer Modal */}
      {pageViewer && (
        <div className="page-viewer-overlay" onClick={handleClosePageViewer}>
          <div className="page-viewer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="page-viewer-header">
              <span className="page-viewer-title">
                {pageViewer.application && `${pageViewer.application} - `}Page {pageViewer.pageNumber}
              </span>
              <button className="page-viewer-close" onClick={handleClosePageViewer} title="Close (Esc)">
                ×
              </button>
            </div>
            <div className="page-viewer-content">
              {pageViewer.isLoading && (
                <div className="page-viewer-loading">
                  <div className="loading-spinner"></div>
                  <p>Loading page...</p>
                </div>
              )}
              <img
                src={pageViewer.pageUrl}
                alt={`Page ${pageViewer.pageNumber}`}
                onLoad={() => setPageViewer(prev => prev ? { ...prev, isLoading: false } : null)}
                onError={() => setPageViewer(prev => prev ? { ...prev, isLoading: false, error: true } : null)}
                style={{ display: pageViewer.isLoading ? 'none' : 'block' }}
              />
              {pageViewer.error && (
                <div className="page-viewer-error">
                  <p>Failed to load page. Please try again.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default UserChat;
