import React, { useState, useEffect, useRef } from 'react';
import { settingsApi, ticketApi, knowledgeApi, documentsApi } from '../services/api';
import './AdminSettings.css';

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', models: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'] },
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { id: 'openrouter', name: 'OpenRouter', models: ['anthropic/claude-3-sonnet', 'openai/gpt-4o', 'google/gemini-pro'] },
  { id: 'custom', name: 'Custom/Local', models: [] }
];

const AdminSettings = () => {
  const [activeTab, setActiveTab] = useState('analytics');

  return (
    <div className="admin-settings-container">
      <header className="settings-header">
        <h1>Admin Settings</h1>
      </header>

      <nav className="settings-tabs">
        <button
          className={activeTab === 'analytics' ? 'active' : ''}
          onClick={() => setActiveTab('analytics')}
        >
          Analytics
        </button>
        <button
          className={activeTab === 'api' ? 'active' : ''}
          onClick={() => setActiveTab('api')}
        >
          API Configuration
        </button>
        <button
          className={activeTab === 'embeddings' ? 'active' : ''}
          onClick={() => setActiveTab('embeddings')}
        >
          Embeddings
        </button>
        <button
          className={activeTab === 'documents' ? 'active' : ''}
          onClick={() => setActiveTab('documents')}
        >
          Documents
        </button>
        <button
          className={activeTab === 'knowledge' ? 'active' : ''}
          onClick={() => setActiveTab('knowledge')}
        >
          Knowledge Base
        </button>
        <button
          className={activeTab === 'prompt' ? 'active' : ''}
          onClick={() => setActiveTab('prompt')}
        >
          System Prompt
        </button>
      </nav>

      <main className="settings-content">
        {activeTab === 'analytics' && <AnalyticsDashboard />}
        {activeTab === 'api' && <ApiSettings />}
        {activeTab === 'embeddings' && <EmbeddingSettings />}
        {activeTab === 'documents' && <DocumentManager />}
        {activeTab === 'knowledge' && <KnowledgeBaseManager />}
        {activeTab === 'prompt' && <SystemPromptEditor />}
      </main>
    </div>
  );
};

// Analytics Dashboard Component
const AnalyticsDashboard = () => {
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const data = await ticketApi.getAnalytics();
      setStats(data);
    } catch (error) {
      console.error('Failed to load analytics:', error);
    } finally {
      setIsLoading(false);
    }
  };

  if (isLoading) {
    return <div className="loading">Loading analytics...</div>;
  }

  if (!stats) {
    return <div className="error">Failed to load analytics</div>;
  }

  return (
    <div className="analytics-dashboard">
      <h2>Ticket Analytics</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.ticketsToday}</div>
          <div className="stat-label">Tickets Today</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.ticketsOpen}</div>
          <div className="stat-label">Open Tickets</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.avgResolutionHours?.toFixed(1) || '0'}h</div>
          <div className="stat-label">Avg Resolution</div>
        </div>
        <div className="stat-card">
          <div className="stat-value">{stats.topApplication?.name || 'N/A'}</div>
          <div className="stat-label">Top App ({stats.topApplication?.percentage || 0}%)</div>
        </div>
      </div>

      <div className="stats-summary">
        <p>Total tickets: {stats.totalTickets || 0}</p>
        <p>Closed tickets: {stats.closedTickets || 0}</p>
      </div>

      <button className="btn-secondary" onClick={loadStats}>
        Refresh Stats
      </button>
    </div>
  );
};

// API Settings Component
const ApiSettings = () => {
  const [settings, setSettings] = useState({
    provider: 'anthropic',
    apiKey: '',
    model: '',
    baseUrl: ''
  });
  const [currentKeyMasked, setCurrentKeyMasked] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadSettings();
  }, []);

  const loadSettings = async () => {
    try {
      const data = await settingsApi.getSettings();
      setSettings({
        provider: data.api_provider || 'anthropic',
        apiKey: '',
        model: data.api_model || '',
        baseUrl: data.api_base_url || ''
      });
      setCurrentKeyMasked(data.api_key_masked || '');
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to load settings' });
    }
  };

  const handleProviderChange = (e) => {
    const provider = e.target.value;
    const providerConfig = PROVIDERS.find(p => p.id === provider);
    setSettings({
      ...settings,
      provider,
      model: providerConfig?.models[0] || '',
      baseUrl: provider === 'custom' ? settings.baseUrl : ''
    });
  };

  const handleSave = async () => {
    setIsLoading(true);
    setMessage({ type: '', text: '' });

    try {
      await settingsApi.updateApiSettings(settings);
      setMessage({ type: 'success', text: 'Settings saved successfully!' });
      setSettings({ ...settings, apiKey: '' });
      loadSettings();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestConnection = async () => {
    if (!settings.apiKey && !currentKeyMasked) {
      setMessage({ type: 'error', text: 'Please enter an API key first' });
      return;
    }

    setIsTesting(true);
    setMessage({ type: '', text: '' });

    try {
      const result = await settingsApi.testApiConnection({
        ...settings,
        apiKey: settings.apiKey || undefined
      });

      if (result.success) {
        setMessage({ type: 'success', text: `Connection successful! ${result.message}` });
      } else {
        setMessage({ type: 'error', text: `Connection failed: ${result.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Connection test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const selectedProvider = PROVIDERS.find(p => p.id === settings.provider);

  return (
    <div className="api-settings">
      <h2>API Configuration</h2>

      {message.text && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      <div className="form-group">
        <label htmlFor="provider">API Provider</label>
        <select id="provider" value={settings.provider} onChange={handleProviderChange}>
          {PROVIDERS.map(p => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="apiKey">API Key</label>
        <input
          type="password"
          id="apiKey"
          value={settings.apiKey}
          onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
          placeholder={currentKeyMasked || 'Enter API key'}
        />
        {currentKeyMasked && (
          <small className="hint">Current key: {currentKeyMasked}</small>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="model">Model</label>
        {selectedProvider?.models.length > 0 ? (
          <select
            id="model"
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
          >
            {selectedProvider.models.map(model => (
              <option key={model} value={model}>{model}</option>
            ))}
          </select>
        ) : (
          <input
            type="text"
            id="model"
            value={settings.model}
            onChange={(e) => setSettings({ ...settings, model: e.target.value })}
            placeholder="Enter model name"
          />
        )}
      </div>

      {settings.provider === 'custom' && (
        <div className="form-group">
          <label htmlFor="baseUrl">Base URL</label>
          <input
            type="text"
            id="baseUrl"
            value={settings.baseUrl}
            onChange={(e) => setSettings({ ...settings, baseUrl: e.target.value })}
            placeholder="https://your-api-endpoint.com/v1"
          />
        </div>
      )}

      <div className="button-group">
        <button className="btn-secondary" onClick={handleTestConnection} disabled={isTesting}>
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={isLoading}>
          {isLoading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

// Embedding Settings Component
const EmbeddingSettings = () => {
  const [providers, setProviders] = useState({});
  const [settings, setSettings] = useState({
    provider: 'openai',
    model: '',
    apiKey: '',
    useChatKey: false,
    ollamaUrl: 'http://localhost:11434'
  });
  const [currentKeyMasked, setCurrentKeyMasked] = useState('');
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isTesting, setIsTesting] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadProviders();
    loadSettings();
  }, []);

  const loadProviders = async () => {
    try {
      const data = await settingsApi.getEmbeddingProviders();
      setProviders(data);
    } catch (error) {
      console.error('Failed to load providers:', error);
    }
  };

  const loadSettings = async () => {
    try {
      const data = await settingsApi.getEmbeddingSettings();
      setSettings({
        provider: data.provider || 'openai',
        model: data.model || '',
        apiKey: '',
        useChatKey: data.useChatKey || false,
        ollamaUrl: data.ollamaUrl || 'http://localhost:11434'
      });
      setCurrentKeyMasked(data.apiKeyMasked || '');
      setStats(data.stats);
    } catch (error) {
      console.error('Failed to load settings:', error);
      setMessage({ type: 'error', text: 'Failed to load embedding settings' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleProviderChange = (e) => {
    const provider = e.target.value;
    const providerConfig = providers[provider];
    setSettings({
      ...settings,
      provider,
      model: providerConfig?.defaultModel || providerConfig?.models?.[0] || ''
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage({ type: '', text: '' });

    try {
      await settingsApi.updateEmbeddingSettings(settings);
      setMessage({ type: 'success', text: 'Embedding settings saved!' });
      setSettings({ ...settings, apiKey: '' });
      loadSettings();
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save settings' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTestConnection = async () => {
    setIsTesting(true);
    setMessage({ type: '', text: '' });

    try {
      const testConfig = {
        provider: settings.provider,
        model: settings.model,
        ollamaUrl: settings.ollamaUrl
      };

      if (settings.apiKey) {
        testConfig.apiKey = settings.apiKey;
      }

      const result = await settingsApi.testEmbeddingConnection(testConfig);

      if (result.success) {
        setMessage({
          type: 'success',
          text: `Connection successful! Model: ${result.model}, Dimensions: ${result.dimensions}`
        });
      } else {
        setMessage({ type: 'error', text: `Connection failed: ${result.error}` });
      }
    } catch (error) {
      setMessage({ type: 'error', text: 'Connection test failed' });
    } finally {
      setIsTesting(false);
    }
  };

  const selectedProvider = providers[settings.provider];

  if (isLoading) {
    return <div className="loading">Loading embedding settings...</div>;
  }

  return (
    <div className="embedding-settings">
      <h2>Embedding Configuration</h2>
      <p className="description">
        Configure the AI provider for generating document embeddings. This is used for semantic search in uploaded documents.
      </p>

      {stats && (
        <div className="embedding-stats">
          <span>Total Chunks: <strong>{stats.totalChunks}</strong></span>
          {stats.storedProvider && (
            <span>Current Provider: <strong>{stats.storedProvider}/{stats.storedModel}</strong></span>
          )}
        </div>
      )}

      {message.text && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      <div className="form-group">
        <label htmlFor="embProvider">Embedding Provider</label>
        <select id="embProvider" value={settings.provider} onChange={handleProviderChange}>
          {Object.entries(providers).map(([id, config]) => (
            <option key={id} value={id}>{config.name}</option>
          ))}
        </select>
      </div>

      <div className="form-group">
        <label htmlFor="embModel">Model</label>
        <select
          id="embModel"
          value={settings.model}
          onChange={(e) => setSettings({ ...settings, model: e.target.value })}
        >
          {selectedProvider?.models?.map(model => (
            <option key={model} value={model}>{model}</option>
          ))}
        </select>
        {selectedProvider?.dimensions?.[settings.model] && (
          <small className="hint">
            Dimensions: {selectedProvider.dimensions[settings.model]}
          </small>
        )}
      </div>

      {settings.provider !== 'ollama' && (
        <>
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={settings.useChatKey}
                onChange={(e) => setSettings({ ...settings, useChatKey: e.target.checked })}
              />
              Use Chat API Key
            </label>
            <small className="hint">
              Enable this if your chat provider (e.g., OpenAI) is the same as your embedding provider.
            </small>
          </div>

          {!settings.useChatKey && (
            <div className="form-group">
              <label htmlFor="embApiKey">Embedding API Key</label>
              <input
                type="password"
                id="embApiKey"
                value={settings.apiKey}
                onChange={(e) => setSettings({ ...settings, apiKey: e.target.value })}
                placeholder={currentKeyMasked || 'Enter API key'}
              />
              {currentKeyMasked && (
                <small className="hint">Current key: {currentKeyMasked}</small>
              )}
            </div>
          )}
        </>
      )}

      {settings.provider === 'ollama' && (
        <div className="form-group">
          <label htmlFor="ollamaUrl">Ollama URL</label>
          <input
            type="text"
            id="ollamaUrl"
            value={settings.ollamaUrl}
            onChange={(e) => setSettings({ ...settings, ollamaUrl: e.target.value })}
            placeholder="http://localhost:11434"
          />
          <small className="hint">
            Make sure Ollama is running and the model is pulled (e.g., `ollama pull nomic-embed-text`)
          </small>
        </div>
      )}

      <div className="button-group">
        <button className="btn-secondary" onClick={handleTestConnection} disabled={isTesting}>
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Settings'}
        </button>
      </div>

      <div className="provider-info">
        <h4>Provider Notes</h4>
        <ul>
          <li><strong>OpenAI:</strong> Best quality, requires API key, small cost per request</li>
          <li><strong>OpenRouter:</strong> Unified API, use same key as chat, access to multiple models</li>
          <li><strong>Cohere:</strong> Free tier available, good quality</li>
          <li><strong>Jina AI:</strong> Free tier available, good for multilingual</li>
          <li><strong>Ollama:</strong> Free, runs locally, no API key needed</li>
        </ul>
      </div>
    </div>
  );
};

// Knowledge Base Manager Component
const KnowledgeBaseManager = () => {
  const [documents, setDocuments] = useState([]);
  const [selectedDoc, setSelectedDoc] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState({
    application: '',
    title: '',
    content: '',
    keywords: ''
  });
  const [isLoading, setIsLoading] = useState(true);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadDocuments();
  }, []);

  const loadDocuments = async () => {
    try {
      const data = await knowledgeApi.getDocuments();
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const handleNew = () => {
    setSelectedDoc(null);
    setFormData({ application: '', title: '', content: '', keywords: '' });
    setIsEditing(true);
  };

  const handleEdit = (doc) => {
    setSelectedDoc(doc);
    setFormData({
      application: doc.application,
      title: doc.title,
      content: doc.content,
      keywords: doc.keywords
    });
    setIsEditing(true);
  };

  const handleSave = async () => {
    setMessage({ type: '', text: '' });

    try {
      if (selectedDoc) {
        await knowledgeApi.updateDocument(selectedDoc.doc_id, formData);
        setMessage({ type: 'success', text: 'Document updated!' });
      } else {
        await knowledgeApi.addDocument(formData);
        setMessage({ type: 'success', text: 'Document created!' });
      }
      loadDocuments();
      setIsEditing(false);
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save document' });
    }
  };

  const handleDelete = async (docId) => {
    if (!confirm('Are you sure you want to delete this document?')) return;

    try {
      await knowledgeApi.deleteDocument(docId);
      loadDocuments();
      setMessage({ type: 'success', text: 'Document deleted!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to delete document' });
    }
  };

  if (isLoading) {
    return <div className="loading">Loading documents...</div>;
  }

  return (
    <div className="knowledge-manager">
      <div className="kb-header">
        <h2>Knowledge Base</h2>
        <button className="btn-primary" onClick={handleNew}>
          + Add Document
        </button>
      </div>

      {message.text && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      {isEditing ? (
        <div className="kb-form">
          <h3>{selectedDoc ? 'Edit Document' : 'New Document'}</h3>
          <div className="form-group">
            <label>Application</label>
            <input
              type="text"
              value={formData.application}
              onChange={(e) => setFormData({ ...formData, application: e.target.value })}
              placeholder="e.g., Attendance, Delivery, Inventory"
            />
          </div>
          <div className="form-group">
            <label>Title</label>
            <input
              type="text"
              value={formData.title}
              onChange={(e) => setFormData({ ...formData, title: e.target.value })}
              placeholder="Document title"
            />
          </div>
          <div className="form-group">
            <label>Content</label>
            <textarea
              value={formData.content}
              onChange={(e) => setFormData({ ...formData, content: e.target.value })}
              placeholder="Full document content..."
              rows={10}
            />
          </div>
          <div className="form-group">
            <label>Keywords (comma-separated)</label>
            <input
              type="text"
              value={formData.keywords}
              onChange={(e) => setFormData({ ...formData, keywords: e.target.value })}
              placeholder="gps, location, error, login"
            />
          </div>
          <div className="button-group">
            <button className="btn-secondary" onClick={() => setIsEditing(false)}>
              Cancel
            </button>
            <button className="btn-primary" onClick={handleSave}>
              Save Document
            </button>
          </div>
        </div>
      ) : (
        <div className="kb-list">
          {documents.length === 0 ? (
            <p className="empty">No documents yet. Add your first knowledge base document.</p>
          ) : (
            documents.map(doc => (
              <div key={doc.doc_id} className="kb-item">
                <div className="kb-item-header">
                  <span className="kb-app">{doc.application}</span>
                  <span className="kb-id">{doc.doc_id}</span>
                </div>
                <h4 className="kb-title">{doc.title}</h4>
                <p className="kb-preview">
                  {doc.content.substring(0, 150)}...
                </p>
                <div className="kb-actions">
                  <button className="btn-secondary" onClick={() => handleEdit(doc)}>
                    Edit
                  </button>
                  <button className="btn-danger" onClick={() => handleDelete(doc.doc_id)}>
                    Delete
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
};

// Document Manager Component (Vector DB)
const DocumentManager = () => {
  const [documents, setDocuments] = useState([]);
  const [stats, setStats] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isUploading, setIsUploading] = useState(false);
  const [showUploadForm, setShowUploadForm] = useState(false);
  const [uploadData, setUploadData] = useState({
    file: null,
    title: '',
    application: ''
  });
  const [message, setMessage] = useState({ type: '', text: '' });
  const [imageViewerDoc, setImageViewerDoc] = useState(null);
  const [docImages, setDocImages] = useState([]);
  const [isLoadingImages, setIsLoadingImages] = useState(false);
  const [imageSettings, setImageSettings] = useState({
    enabled: true,
    visionModel: 'openai/gpt-4o-mini',
    maxImagesPerDoc: 20
  });
  const [showImageSettings, setShowImageSettings] = useState(false);
  const fileInputRef = useRef(null);

  // Dynamic application options from API
  const [applications, setApplications] = useState([]);
  const [showCustomAppInput, setShowCustomAppInput] = useState(false);
  const [customApplication, setCustomApplication] = useState('');

  useEffect(() => {
    loadDocuments();
    loadStats();
    loadImageSettings();
    loadApplications();
  }, []);

  const loadApplications = async () => {
    try {
      const apps = await documentsApi.getApplications();
      // Combine existing applications with some defaults, then add "Other"
      const defaultApps = ['Attendance', 'Delivery', 'Inventory', 'Nafien'];
      const allApps = [...new Set([...defaultApps, ...apps])].sort();
      setApplications([...allApps, 'Other']);
    } catch (error) {
      console.error('Failed to load applications:', error);
      // Fallback to defaults if API fails
      setApplications(['Attendance', 'Delivery', 'Inventory', 'Nafien', 'Other']);
    }
  };

  const handleApplicationChange = (e) => {
    const value = e.target.value;
    if (value === 'Other') {
      setShowCustomAppInput(true);
      setUploadData({ ...uploadData, application: customApplication });
    } else {
      setShowCustomAppInput(false);
      setCustomApplication('');
      setUploadData({ ...uploadData, application: value });
    }
  };

  const loadDocuments = async () => {
    try {
      const data = await documentsApi.getDocuments();
      setDocuments(data);
    } catch (error) {
      console.error('Failed to load documents:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const loadStats = async () => {
    try {
      const data = await documentsApi.getStats();
      setStats(data);
    } catch (error) {
      console.error('Failed to load stats:', error);
    }
  };

  const loadImageSettings = async () => {
    try {
      const data = await settingsApi.getImageExtractionSettings();
      setImageSettings(data);
    } catch (error) {
      console.error('Failed to load image settings:', error);
    }
  };

  const handleSaveImageSettings = async () => {
    try {
      await settingsApi.updateImageExtractionSettings(imageSettings);
      setMessage({ type: 'success', text: 'Image extraction settings saved!' });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save image settings' });
    }
  };

  const handleViewImages = async (doc) => {
    setImageViewerDoc(doc);
    setIsLoadingImages(true);
    setDocImages([]);

    try {
      const images = await documentsApi.getDocumentImages(doc.doc_id);
      setDocImages(images);
    } catch (error) {
      console.error('Failed to load images:', error);
      setMessage({ type: 'error', text: 'Failed to load images' });
    } finally {
      setIsLoadingImages(false);
    }
  };

  const handleFileSelect = (e) => {
    const file = e.target.files[0];
    if (file) {
      const ext = file.name.toLowerCase().split('.').pop();
      const allowedTypes = ['application/pdf', 'text/markdown', 'text/x-markdown'];
      const allowedExtensions = ['pdf', 'md'];

      if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(ext)) {
        setMessage({ type: 'error', text: 'Only PDF and Markdown (.md) files are allowed' });
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setMessage({ type: 'error', text: 'File size must be less than 10MB' });
        return;
      }
      setUploadData({
        ...uploadData,
        file: file,
        title: file.name.replace(/\.(pdf|md)$/i, '')
      });
      setMessage({ type: '', text: '' });
    }
  };

  const handleUpload = async () => {
    if (!uploadData.file) {
      setMessage({ type: 'error', text: 'Please select a file' });
      return;
    }
    if (!uploadData.application) {
      setMessage({ type: 'error', text: 'Please select an application' });
      return;
    }

    setIsUploading(true);
    setMessage({ type: '', text: '' });

    try {
      const result = await documentsApi.uploadDocument(
        uploadData.file,
        uploadData.title,
        uploadData.application
      );

      setMessage({
        type: 'success',
        text: `Document uploaded successfully! Created ${result.document.chunkCount} chunks.`
      });

      // Reset form
      setUploadData({ file: null, title: '', application: '' });
      setShowUploadForm(false);
      setShowCustomAppInput(false);
      setCustomApplication('');
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }

      // Reload applications to include newly added one
      loadApplications();

      // Reload data
      loadDocuments();
      loadStats();
    } catch (error) {
      setMessage({ type: 'error', text: `Upload failed: ${error.message}` });
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (docId, filename) => {
    if (!confirm(`Are you sure you want to delete "${filename}"? This will also remove all associated vector embeddings.`)) {
      return;
    }

    try {
      await documentsApi.deleteDocument(docId);
      setMessage({ type: 'success', text: 'Document deleted successfully' });
      loadDocuments();
      loadStats();
    } catch (error) {
      setMessage({ type: 'error', text: `Delete failed: ${error.message}` });
    }
  };

  const formatFileSize = (bytes) => {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  };

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  if (isLoading) {
    return <div className="loading">Loading documents...</div>;
  }

  return (
    <div className="document-manager">
      <div className="doc-header">
        <h2>Document Management</h2>
        <button className="btn-primary" onClick={() => setShowUploadForm(!showUploadForm)}>
          {showUploadForm ? 'Cancel' : '+ Upload Document'}
        </button>
      </div>

      <p className="description">
        Upload PDF documents to create searchable embeddings. The AI will use these documents to answer user questions with semantic search.
      </p>

      {stats && (
        <div className="doc-stats">
          <div className="stat-item">
            <span className="stat-value">{stats.documentCount || 0}</span>
            <span className="stat-label">Documents</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.totalChunks || 0}</span>
            <span className="stat-label">Total Chunks</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.totalImages || 0}</span>
            <span className="stat-label">Total Images</span>
          </div>
          <div className="stat-item">
            <span className="stat-value">{stats.embeddingModel || 'N/A'}</span>
            <span className="stat-label">Embedding Model</span>
          </div>
        </div>
      )}

      <div className="image-settings-toggle">
        <button
          className="btn-secondary"
          onClick={() => setShowImageSettings(!showImageSettings)}
        >
          {showImageSettings ? 'Hide' : 'Show'} Image Extraction Settings
        </button>
      </div>

      {showImageSettings && (
        <div className="image-settings-form">
          <h3>Image Extraction Settings</h3>
          <div className="form-group checkbox-group">
            <label>
              <input
                type="checkbox"
                checked={imageSettings.enabled}
                onChange={(e) => setImageSettings({ ...imageSettings, enabled: e.target.checked })}
              />
              Enable Image Extraction
            </label>
            <small className="hint">
              When enabled, images are extracted from PDFs, described by AI, and made searchable.
            </small>
          </div>

          <div className="form-group">
            <label>Vision Model</label>
            <select
              value={imageSettings.visionModel}
              onChange={(e) => setImageSettings({ ...imageSettings, visionModel: e.target.value })}
            >
              <option value="openai/gpt-4o-mini">OpenAI GPT-4o Mini (Recommended)</option>
              <option value="openai/gpt-4o">OpenAI GPT-4o</option>
              <option value="anthropic/claude-3-haiku">Claude 3 Haiku</option>
              <option value="anthropic/claude-3-sonnet">Claude 3 Sonnet</option>
            </select>
            <small className="hint">Model used to generate text descriptions of images.</small>
          </div>

          <div className="form-group">
            <label>Max Images Per Document</label>
            <input
              type="number"
              min="1"
              max="50"
              value={imageSettings.maxImagesPerDoc}
              onChange={(e) => setImageSettings({ ...imageSettings, maxImagesPerDoc: parseInt(e.target.value) || 20 })}
            />
            <small className="hint">Maximum number of images to extract per PDF.</small>
          </div>

          <button className="btn-primary" onClick={handleSaveImageSettings}>
            Save Image Settings
          </button>
        </div>
      )}

      {message.text && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      {showUploadForm && (
        <div className="upload-form">
          <h3>Upload New Document</h3>

          <div className="form-group">
            <label>Document File (PDF or Markdown)</label>
            <input
              type="file"
              accept=".pdf,.md"
              onChange={handleFileSelect}
              ref={fileInputRef}
            />
            {uploadData.file && (
              <small className="hint">
                Selected: {uploadData.file.name} ({formatFileSize(uploadData.file.size)})
                {uploadData.file.name.toLowerCase().endsWith('.md') && (
                  <span className="file-type-badge"> - Markdown (header-based chunking)</span>
                )}
              </small>
            )}
          </div>

          <div className="form-group">
            <label>Document Title</label>
            <input
              type="text"
              value={uploadData.title}
              onChange={(e) => setUploadData({ ...uploadData, title: e.target.value })}
              placeholder="Enter document title"
            />
          </div>

          <div className="form-group">
            <label>Application *</label>
            <select
              value={showCustomAppInput ? 'Other' : uploadData.application}
              onChange={handleApplicationChange}
            >
              <option value="">Select application...</option>
              {applications.map(app => (
                <option key={app} value={app}>{app}</option>
              ))}
            </select>
            <small className="hint">
              This determines which application's queries will search this document.
            </small>
          </div>

          {showCustomAppInput && (
            <div className="form-group">
              <label>Custom Application Name *</label>
              <input
                type="text"
                value={customApplication}
                onChange={(e) => {
                  setCustomApplication(e.target.value);
                  setUploadData({ ...uploadData, application: e.target.value });
                }}
                placeholder="Enter new application name"
              />
              <small className="hint">
                Enter a new application name. It will be available in the dropdown for future uploads.
              </small>
            </div>
          )}

          <div className="button-group">
            <button
              className="btn-secondary"
              onClick={() => {
                setShowUploadForm(false);
                setUploadData({ file: null, title: '', application: '' });
                setShowCustomAppInput(false);
                setCustomApplication('');
              }}
            >
              Cancel
            </button>
            <button
              className="btn-primary"
              onClick={handleUpload}
              disabled={isUploading || !uploadData.file || !uploadData.application}
            >
              {isUploading ? 'Uploading & Processing...' : 'Upload Document'}
            </button>
          </div>
        </div>
      )}

      <div className="doc-list">
        <h3>Uploaded Documents</h3>
        {documents.length === 0 ? (
          <p className="empty">No documents uploaded yet. Upload your first document to enable semantic search.</p>
        ) : (
          <table className="doc-table">
            <thead>
              <tr>
                <th>Title</th>
                <th>Application</th>
                <th>Pages</th>
                <th>Chunks</th>
                <th>Images</th>
                <th>Size</th>
                <th>Uploaded</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map(doc => (
                <tr key={doc.doc_id}>
                  <td className="doc-title">
                    <strong>{doc.title}</strong>
                    <br />
                    <small>{doc.filename}</small>
                  </td>
                  <td>
                    <span className="app-badge">{doc.application}</span>
                  </td>
                  <td>{doc.num_pages}</td>
                  <td>{doc.chunk_count}</td>
                  <td>
                    {parseInt(doc.image_count) > 0 ? (
                      <button
                        className="btn-link"
                        onClick={() => handleViewImages(doc)}
                      >
                        {doc.image_count} images
                      </button>
                    ) : (
                      <span className="text-muted">0</span>
                    )}
                  </td>
                  <td>{formatFileSize(parseInt(doc.file_size) || 0)}</td>
                  <td>{formatDate(doc.upload_date)}</td>
                  <td>
                    <button
                      className="btn-danger btn-small"
                      onClick={() => handleDelete(doc.doc_id, doc.filename)}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Image Viewer Modal */}
      {imageViewerDoc && (
        <div className="modal-overlay" onClick={() => setImageViewerDoc(null)}>
          <div className="modal-content image-viewer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3>Images from: {imageViewerDoc.title}</h3>
              <button className="modal-close" onClick={() => setImageViewerDoc(null)}>×</button>
            </div>
            <div className="modal-body">
              {isLoadingImages ? (
                <div className="loading">Loading images...</div>
              ) : docImages.length === 0 ? (
                <p className="empty">No images found for this document.</p>
              ) : (
                <div className="image-grid">
                  {docImages.map((img, index) => (
                    <div key={index} className="image-item">
                      <img
                        src={img.url}
                        alt={`Image ${index + 1} from ${imageViewerDoc.title}`}
                        loading="lazy"
                      />
                      <div className="image-caption">{img.filename}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// System Prompt Editor Component
const SystemPromptEditor = () => {
  const [customPrompt, setCustomPrompt] = useState('');
  const [defaultPrompt, setDefaultPrompt] = useState('');
  const [isCustom, setIsCustom] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [message, setMessage] = useState({ type: '', text: '' });

  useEffect(() => {
    loadSystemPrompt();
  }, []);

  const loadSystemPrompt = async () => {
    try {
      const data = await settingsApi.getSystemPrompt();
      setCustomPrompt(data.customPrompt || '');
      setDefaultPrompt(data.defaultPrompt || '');
      setIsCustom(data.isCustom);
    } catch (error) {
      console.error('Failed to load system prompt:', error);
      setMessage({ type: 'error', text: 'Failed to load system prompt' });
    } finally {
      setIsLoading(false);
    }
  };

  const handleSave = async () => {
    setIsSaving(true);
    setMessage({ type: '', text: '' });

    try {
      await settingsApi.updateSystemPrompt(customPrompt);
      setIsCustom(!!customPrompt);
      setMessage({
        type: 'success',
        text: customPrompt ? 'System prompt updated!' : 'System prompt reset to default!'
      });
    } catch (error) {
      setMessage({ type: 'error', text: 'Failed to save system prompt' });
    } finally {
      setIsSaving(false);
    }
  };

  const handleReset = () => {
    setCustomPrompt('');
    setMessage({ type: 'info', text: 'Click Save to apply the default prompt' });
  };

  const handleUseDefault = () => {
    setCustomPrompt(defaultPrompt);
    setMessage({ type: 'info', text: 'Default prompt loaded. Modify it and save to use as custom prompt.' });
  };

  if (isLoading) {
    return <div className="loading">Loading system prompt...</div>;
  }

  return (
    <div className="system-prompt-editor">
      <h2>System Prompt / Guardrails</h2>
      <p className="description">
        Customize the AI assistant's behavior, tone, and boundaries. This prompt tells the AI how to respond to users.
      </p>

      {message.text && (
        <div className={`message ${message.type}`}>{message.text}</div>
      )}

      <div className="prompt-status">
        {isCustom ? (
          <span className="status-badge custom">Using Custom Prompt</span>
        ) : (
          <span className="status-badge default">Using Default Prompt</span>
        )}
      </div>

      <div className="form-group">
        <label htmlFor="systemPrompt">
          System Prompt {isCustom && '(Custom)'}
        </label>
        <textarea
          id="systemPrompt"
          value={customPrompt || ''}
          onChange={(e) => setCustomPrompt(e.target.value)}
          placeholder={defaultPrompt}
          rows={20}
          className="prompt-textarea"
        />
        <small className="hint">
          Leave empty to use the default prompt. The Knowledge Base documents are automatically appended at the end.
        </small>
      </div>

      <div className="button-group">
        <button className="btn-secondary" onClick={handleUseDefault}>
          Load Default
        </button>
        <button className="btn-secondary" onClick={handleReset}>
          Reset to Default
        </button>
        <button className="btn-primary" onClick={handleSave} disabled={isSaving}>
          {isSaving ? 'Saving...' : 'Save Prompt'}
        </button>
      </div>

      <details className="default-prompt-preview">
        <summary>View Default Prompt</summary>
        <pre>{defaultPrompt}</pre>
      </details>
    </div>
  );
};

export default AdminSettings;
