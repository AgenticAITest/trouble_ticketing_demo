/**
 * API service for communicating with the backend
 */

const API_BASE = '/api';

/**
 * Get auth headers from localStorage
 */
function getAuthHeaders() {
  const credentials = localStorage.getItem('auth_credentials');
  if (!credentials) return {};
  return { Authorization: `Basic ${credentials}` };
}

/**
 * Generic fetch wrapper with error handling
 */
async function fetchApi(endpoint, options = {}) {
  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || 'Request failed');
  }

  return response.json();
}

// ============================================
// CHAT API
// ============================================

export const chatApi = {
  sendMessage: async (sessionId, message) => {
    return fetchApi('/chat/message', {
      method: 'POST',
      body: JSON.stringify({ sessionId, message })
    });
  },

  getSession: async (sessionId) => {
    return fetchApi(`/chat/session/${sessionId}`);
  },

  checkNotifications: async (sessionId) => {
    return fetchApi(`/chat/notifications/${sessionId}`);
  },

  markAsRead: async (sessionId) => {
    return fetchApi('/chat/mark-read', {
      method: 'POST',
      body: JSON.stringify({ sessionId })
    });
  },

  exportTranscript: async (sessionId) => {
    const response = await fetch(`${API_BASE}/chat/export/${sessionId}`);
    if (!response.ok) throw new Error('Failed to export transcript');

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `chat-transcript-${sessionId}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.URL.revokeObjectURL(url);
  }
};

// ============================================
// TICKET API
// ============================================

export const ticketApi = {
  getTickets: async (status) => {
    const url = status ? `/tickets?status=${status}` : '/tickets';
    return fetchApi(url, { headers: getAuthHeaders() });
  },

  getTicket: async (ticketId) => {
    return fetchApi(`/tickets/${ticketId}`, { headers: getAuthHeaders() });
  },

  updateTicket: async (ticketId, updates) => {
    return fetchApi(`/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: getAuthHeaders(),
      body: JSON.stringify(updates)
    });
  },

  askClarification: async (ticketId, question) => {
    return fetchApi(`/tickets/${ticketId}/clarify`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({ question })
    });
  },

  getAnalytics: async () => {
    return fetchApi('/tickets/analytics', { headers: getAuthHeaders() });
  },

  analyzeTicket: async (ticketId) => {
    return fetchApi(`/tickets/${ticketId}/analyze`, {
      method: 'POST',
      headers: getAuthHeaders()
    });
  }
};

// ============================================
// SETTINGS API
// ============================================

export const settingsApi = {
  getSettings: async () => {
    return fetchApi('/settings', { headers: getAuthHeaders() });
  },

  updateApiSettings: async (settings) => {
    return fetchApi('/settings/api', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    });
  },

  testApiConnection: async (settings) => {
    return fetchApi('/settings/test-api', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    });
  },

  getSystemPrompt: async () => {
    return fetchApi('/settings/system-prompt', { headers: getAuthHeaders() });
  },

  updateSystemPrompt: async (prompt) => {
    return fetchApi('/settings/system-prompt', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({ prompt })
    });
  },

  // Embedding settings
  getEmbeddingProviders: async () => {
    return fetchApi('/settings/embedding-providers', { headers: getAuthHeaders() });
  },

  getEmbeddingSettings: async () => {
    return fetchApi('/settings/embeddings', { headers: getAuthHeaders() });
  },

  updateEmbeddingSettings: async (settings) => {
    return fetchApi('/settings/embeddings', {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    });
  },

  testEmbeddingConnection: async (settings) => {
    return fetchApi('/settings/test-embeddings', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(settings)
    });
  }
};

// ============================================
// KNOWLEDGE BASE API
// ============================================

export const knowledgeApi = {
  getDocuments: async () => {
    return fetchApi('/knowledge');
  },

  getDocument: async (docId) => {
    return fetchApi(`/knowledge/${docId}`);
  },

  addDocument: async (doc) => {
    return fetchApi('/knowledge', {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify(doc)
    });
  },

  updateDocument: async (docId, doc) => {
    return fetchApi(`/knowledge/${docId}`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify(doc)
    });
  },

  deleteDocument: async (docId) => {
    return fetchApi(`/knowledge/${docId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  }
};

// ============================================
// DOCUMENTS API (Vector DB)
// ============================================

export const documentsApi = {
  getDocuments: async () => {
    return fetchApi('/documents', { headers: getAuthHeaders() });
  },

  getDocument: async (docId) => {
    return fetchApi(`/documents/${docId}`, { headers: getAuthHeaders() });
  },

  uploadDocument: async (file, title, application) => {
    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title);
    formData.append('application', application);

    const credentials = localStorage.getItem('auth_credentials');
    const headers = credentials ? { Authorization: `Basic ${credentials}` } : {};

    const response = await fetch(`${API_BASE}/documents/upload`, {
      method: 'POST',
      headers: headers,
      body: formData
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Upload failed' }));
      throw new Error(error.error || error.message || 'Upload failed');
    }

    return response.json();
  },

  deleteDocument: async (docId) => {
    return fetchApi(`/documents/${docId}`, {
      method: 'DELETE',
      headers: getAuthHeaders()
    });
  },

  search: async (query, application = null) => {
    return fetchApi('/documents/search', {
      method: 'POST',
      body: JSON.stringify({ query, application })
    });
  },

  getStats: async () => {
    return fetchApi('/documents/stats/summary', { headers: getAuthHeaders() });
  }
};

// ============================================
// HEALTH API
// ============================================

export const healthApi = {
  check: async () => {
    return fetchApi('/health');
  }
};
