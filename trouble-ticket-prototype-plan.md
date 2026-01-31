# Trouble Ticketing AI Assistant - Development Plan

## Overview

| Attribute | Value |
|-----------|-------|
| Project Type | Prototype |
| Target Users | End Users, IT Support, Management |
| Tech Stack | React (frontend), Node.js (backend), Google Sheets (database), Claude API (AI) |
| Estimated Build Time | 2-2.5 weeks |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (React)                               │
│  ┌─────────────────────────────┐    ┌─────────────────────────────────┐    │
│  │     User Chat Interface     │    │     IT Support Dashboard        │    │
│  │  • Chat window              │    │  • Ticket list                  │    │
│  │  • Bell notification 🔔     │    │  • Ticket detail view           │    │
│  │  • Session management       │    │  • Log viewer                   │    │
│  └─────────────────────────────┘    │  • Ask clarification            │    │
│                                      └─────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                        Admin Settings Page                          │    │
│  │  • API Provider selection (OpenAI, Anthropic, OpenRouter, etc.)    │    │
│  │  • API Key configuration                                            │    │
│  │  • Knowledge Base document management                               │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            BACKEND (Node.js/Express)                        │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │ Chat API     │ │ Ticket API   │ │ Knowledge    │ │ Mock Log     │       │
│  │ /api/chat    │ │ /api/tickets │ │ Base Loader  │ │ Service      │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│  ┌──────────────┐                                                           │
│  │ Settings API │                                                           │
│  │ /api/settings│                                                           │
│  └──────────────┘                                                           │
│                         ┌───────────────────────────┐                       │
│                         │     LLM Service           │                       │
│                         │  • Multi-provider support │                       │
│                         │  • OpenAI, Anthropic,     │                       │
│                         │    OpenRouter, etc.       │                       │
│                         └───────────────────────────┘                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                          GOOGLE SHEETS (Database)                           │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐       │
│  │   Tickets    │ │   Messages   │ │   Mock Logs  │ │  Knowledge   │       │
│  │    Sheet     │ │    Sheet     │ │    Sheet     │ │  Base Sheet  │       │
│  └──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘       │
│  ┌──────────────┐                                                           │
│  │   Settings   │                                                           │
│  │    Sheet     │                                                           │
│  └──────────────┘                                                           │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Part 0: Security & Authentication

### 0.1 Route Protection

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           ACCESS CONTROL                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  /chat              → Public (end users)                                    │
│  /it-support        → Requires IT_SUPPORT role                              │
│  /admin/settings    → Requires ADMIN role                                   │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 0.2 Simple Auth Middleware

For the prototype, use a simple password-based role system stored in the settings sheet.

```javascript
// server/middleware/auth.js

const { getSetting } = require('../services/googleSheets');
const crypto = require('crypto');

// Hash passwords before comparing
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// Middleware to check role
function requireRole(role) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const [username, password] = credentials.split(':');

    // Get stored credentials from settings
    const storedHash = await getSetting(`${role}_password_hash`);

    if (!storedHash || hashPassword(password) !== storedHash) {
      return res.status(403).json({ error: 'Access denied' });
    }

    req.userRole = role;
    next();
  };
}

module.exports = { requireRole, hashPassword };
```

### 0.3 Input Sanitization

```javascript
// server/middleware/sanitize.js

const createDOMPurify = require('dompurify');
const { JSDOM } = require('jsdom');

const window = new JSDOM('').window;
const DOMPurify = createDOMPurify(window);

function sanitizeInput(req, res, next) {
  if (req.body) {
    Object.keys(req.body).forEach(key => {
      if (typeof req.body[key] === 'string') {
        req.body[key] = DOMPurify.sanitize(req.body[key], { ALLOWED_TAGS: [] });
      }
    });
  }
  next();
}

module.exports = { sanitizeInput };
```

### 0.4 Request Validation

```javascript
// server/middleware/validate.js

const { body, param, validationResult } = require('express-validator');

const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({ errors: errors.array() });
  }
  next();
};

// Validation rules for different endpoints
const chatMessageRules = [
  body('sessionId').isString().notEmpty().isLength({ max: 100 }),
  body('message').isString().trim().isLength({ min: 1, max: 5000 })
];

const ticketUpdateRules = [
  param('id').matches(/^TKT-\d{5}$/),
  body('status').optional().isIn(['open', 'waiting_clarification', 'waiting_confirmation', 'closed']),
  body('it_notes').optional().isString().isLength({ max: 2000 })
];

const settingsRules = [
  body('provider').optional().isIn(['anthropic', 'openai', 'openrouter', 'custom']),
  body('apiKey').optional().isString().isLength({ min: 10, max: 200 }),
  body('model').optional().isString().isLength({ max: 100 }),
  body('baseUrl').optional().isURL()
];

module.exports = {
  validateRequest,
  chatMessageRules,
  ticketUpdateRules,
  settingsRules
};
```

---

## Part 1: Google Sheets Setup & Integration

### 1.1 Google Cloud Setup (One-time)

```
Step 1: Create Google Cloud Project
        → Go to console.cloud.google.com
        → Create new project: "TroubleTicketPrototype"

Step 2: Enable Google Sheets API
        → APIs & Services → Enable APIs
        → Search "Google Sheets API" → Enable

Step 3: Create Service Account
        → APIs & Services → Credentials
        → Create Credentials → Service Account
        → Name: "ticket-app-service"
        → Role: Editor
        → Create Key → JSON → Download

Step 4: Save credentials
        → Rename to: google-credentials.json
        → Place in: /server/config/
        → Add to .gitignore
```

### 1.2 Google Sheets Structure

**Create a new Google Spreadsheet named: `TroubleTicket_DB`**

Share the spreadsheet with the service account email (found in google-credentials.json as `client_email`).

#### Sheet 1: `tickets`

| Column | Type | Description |
|--------|------|-------------|
| ticket_id | String | Auto-generated: TKT-XXXXX |
| session_id | String | Links to user chat session |
| status | String | open, waiting_clarification, waiting_confirmation, closed |
| application | String | Name of affected application |
| problem_summary | String | AI-generated summary |
| problem_details | String | Full user description |
| reported_at | DateTime | When ticket was created |
| updated_at | DateTime | Last update timestamp |
| assigned_log | String | Mock log ID (log_01, log_02, etc.) |
| suggested_fix | String | AI-suggested resolution |
| it_notes | String | Notes from IT support |
| resolved_at | DateTime | When marked resolved |

#### Sheet 2: `messages`

| Column | Type | Description |
|--------|------|-------------|
| message_id | String | Auto-generated UUID |
| session_id | String | Chat session identifier |
| ticket_id | String | Linked ticket (if any) |
| sender | String | user, ai, it_support |
| content | String | Message text |
| timestamp | DateTime | When sent |
| read | Boolean | Has recipient read this? |

#### Sheet 3: `mock_logs`

| Column | Type | Description |
|--------|------|-------------|
| log_id | String | log_01, log_02, etc. |
| application | String | Which app this log is for |
| error_pattern | String | Keywords to match |
| log_content | String | Simulated log output |
| suggested_fix | String | Recommended resolution |

#### Sheet 4: `knowledge_base`

| Column | Type | Description |
|--------|------|-------------|
| doc_id | String | kb_01, kb_02, etc. |
| application | String | Which app this doc covers |
| title | String | Document title |
| content | String | Full document text |
| keywords | String | Comma-separated search terms |

#### Sheet 5: `settings`

| Column | Type | Description |
|--------|------|-------------|
| setting_key | String | Unique setting identifier |
| setting_value | String | The value (encrypted for sensitive data) |
| updated_at | DateTime | Last update timestamp |

**Initial settings rows:**
| setting_key | setting_value | updated_at |
|-------------|---------------|------------|
| api_provider | anthropic | (timestamp) |
| api_key | (encrypted) | (timestamp) |
| api_model | claude-sonnet-4-20250514 | (timestamp) |

### 1.3 Google Sheets Integration Code

**Recommended package:** `google-spreadsheet` (v4.x)

```javascript
// server/services/googleSheets.js

const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const SPREADSHEET_ID = 'your-spreadsheet-id-here';

// Initialize auth
const serviceAccountAuth = new JWT({
  email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
  key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  scopes: ['https://www.googleapis.com/auth/spreadsheets'],
});

// Initialize document
const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);

// Helper functions
async function initSheet() {
  await doc.loadInfo();
  return doc;
}

async function getSheet(sheetName) {
  await initSheet();
  return doc.sheetsByTitle[sheetName];
}

// CRUD Operations
async function createTicket(ticketData) {
  const sheet = await getSheet('tickets');
  const row = await sheet.addRow(ticketData);
  return row.toObject();
}

async function getTicketsByStatus(status) {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  return rows
    .filter(row => row.get('status') === status)
    .map(row => row.toObject());
}

async function updateTicket(ticketId, updates) {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ticket_id') === ticketId);
  if (row) {
    Object.entries(updates).forEach(([key, value]) => {
      row.set(key, value);
    });
    await row.save();
    return row.toObject();
  }
  return null;
}

async function addMessage(messageData) {
  const sheet = await getSheet('messages');
  const row = await sheet.addRow(messageData);
  return row.toObject();
}

async function getMessagesBySession(sessionId) {
  const sheet = await getSheet('messages');
  const rows = await sheet.getRows();
  return rows
    .filter(row => row.get('session_id') === sessionId)
    .map(row => row.toObject())
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

async function getUnreadMessages(sessionId) {
  const sheet = await getSheet('messages');
  const rows = await sheet.getRows();
  return rows
    .filter(row => 
      row.get('session_id') === sessionId && 
      row.get('read') === 'FALSE' &&
      row.get('sender') === 'it_support'
    )
    .map(row => row.toObject());
}

async function getMockLog(logId) {
  const sheet = await getSheet('mock_logs');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('log_id') === logId);
  return row ? row.toObject() : null;
}

async function getKnowledgeBase() {
  const sheet = await getSheet('knowledge_base');
  const rows = await sheet.getRows();
  return rows.map(row => row.toObject());
}

// Settings functions
async function getSetting(key) {
  const sheet = await getSheet('settings');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('setting_key') === key);
  return row ? row.get('setting_value') : null;
}

async function updateSetting(key, value) {
  const sheet = await getSheet('settings');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('setting_key') === key);
  if (row) {
    row.set('setting_value', value);
    row.set('updated_at', new Date().toISOString());
    await row.save();
  } else {
    await sheet.addRow({
      setting_key: key,
      setting_value: value,
      updated_at: new Date().toISOString()
    });
  }
}

async function getAllSettings() {
  const sheet = await getSheet('settings');
  const rows = await sheet.getRows();
  const settings = {};
  rows.forEach(row => {
    settings[row.get('setting_key')] = row.get('setting_value');
  });
  return settings;
}

module.exports = {
  createTicket,
  getTicketsByStatus,
  updateTicket,
  addMessage,
  getMessagesBySession,
  getUnreadMessages,
  getMockLog,
  getKnowledgeBase,
  getSetting,
  updateSetting,
  getAllSettings,
};
```

### 1.4 Integration Complexity Assessment

| Operation | Complexity | Notes |
|-----------|------------|-------|
| Read rows | Simple | Single API call |
| Add row | Simple | Single API call |
| Update row | Simple | Find + save |
| Filter rows | Simple | Done in JavaScript |
| Real-time sync | N/A | Polling every 5-10 seconds |

**Verdict: Google Sheets integration is straightforward for this prototype.**

---

## Part 2: File Structure

```
trouble-ticket-app/
├── client/                          # React Frontend
│   ├── public/
│   │   └── index.html
│   ├── src/
│   │   ├── components/
│   │   │   ├── user/
│   │   │   │   ├── ChatWindow.jsx
│   │   │   │   ├── MessageBubble.jsx
│   │   │   │   ├── NotificationBell.jsx
│   │   │   │   ├── ConversationStarters.jsx  # NEW
│   │   │   │   └── TypingIndicator.jsx
│   │   │   ├── it-support/
│   │   │   │   ├── Dashboard.jsx
│   │   │   │   ├── TicketList.jsx
│   │   │   │   ├── TicketDetail.jsx
│   │   │   │   ├── LogViewer.jsx
│   │   │   │   ├── CannedResponses.jsx       # NEW
│   │   │   │   └── ClarificationForm.jsx
│   │   │   ├── admin/
│   │   │   │   ├── SettingsPage.jsx
│   │   │   │   ├── ApiSettings.jsx
│   │   │   │   ├── AnalyticsDashboard.jsx    # NEW
│   │   │   │   └── KnowledgeBaseManager.jsx
│   │   │   └── shared/
│   │   │       ├── Header.jsx
│   │   │       ├── Sidebar.jsx
│   │   │       ├── ProtectedRoute.jsx        # NEW
│   │   │       └── StatusBadge.jsx
│   │   ├── pages/
│   │   │   ├── UserChat.jsx
│   │   │   ├── ITSupport.jsx
│   │   │   ├── AdminSettings.jsx
│   │   │   └── Login.jsx                     # NEW
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── hooks/
│   │   │   ├── useChat.js
│   │   │   ├── useAuth.js                    # NEW
│   │   │   └── useNotifications.js
│   │   ├── context/
│   │   │   ├── SessionContext.jsx
│   │   │   └── AuthContext.jsx               # NEW
│   │   ├── App.jsx
│   │   └── index.js
│   └── package.json
│
├── server/                          # Node.js Backend
│   ├── config/
│   │   └── google-credentials.json  # (gitignored)
│   ├── routes/
│   │   ├── chat.js
│   │   ├── tickets.js
│   │   ├── knowledge.js
│   │   ├── settings.js
│   │   └── health.js                 # NEW
│   ├── services/
│   │   ├── googleSheets.js
│   │   ├── llmService.js            # Multi-provider LLM service (with retry)
│   │   ├── knowledgeBase.js
│   │   └── mockLogs.js
│   ├── prompts/
│   │   ├── systemPrompt.js
│   │   ├── intakePrompt.js
│   │   └── supportPrompt.js
│   ├── middleware/
│   │   ├── auth.js                   # NEW - role-based auth
│   │   ├── sanitize.js               # NEW - input sanitization
│   │   ├── validate.js               # NEW - request validation
│   │   ├── errorHandler.js
│   │   └── encryption.js
│   ├── app.js
│   └── package.json
│
├── knowledge-docs/                  # Knowledge Base Documents
│   ├── attendance-app-troubleshooting.md
│   ├── delivery-app-faq.md
│   └── general-it-faq.md
│
├── .env.example
├── .gitignore
└── README.md
```

---

## Part 3: Admin Settings Page

### 3.1 Supported API Providers

| Provider | Base URL | Model Examples |
|----------|----------|----------------|
| Anthropic | https://api.anthropic.com/v1 | claude-sonnet-4-20250514, claude-3-haiku-20240307 |
| OpenAI | https://api.openai.com/v1 | gpt-4o, gpt-4o-mini, gpt-3.5-turbo |
| OpenRouter | https://openrouter.ai/api/v1 | anthropic/claude-3-sonnet, openai/gpt-4o |
| Custom/Local | (user-defined) | Any OpenAI-compatible API |

**Note:** Google AI support was removed to simplify the codebase. OpenRouter provides access to Gemini models if needed.

### 3.2 Settings API Endpoints

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          SETTINGS API ENDPOINTS                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  GET    /api/settings              Get all settings (API key masked)        │
│  PUT    /api/settings/api          Update API provider and key              │
│  POST   /api/settings/test-api     Test API connection                      │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.3 Settings Route Implementation

```javascript
// server/routes/settings.js

const express = require('express');
const router = express.Router();
const { getAllSettings, updateSetting, getSetting } = require('../services/googleSheets');
const { encrypt, decrypt } = require('../middleware/encryption');
const { testLLMConnection } = require('../services/llmService');

// Get all settings (mask sensitive data)
router.get('/', async (req, res) => {
  try {
    const settings = await getAllSettings();
    
    // Mask API key for display
    if (settings.api_key) {
      const decrypted = decrypt(settings.api_key);
      settings.api_key_masked = decrypted 
        ? `${decrypted.substring(0, 8)}...${decrypted.substring(decrypted.length - 4)}`
        : '';
      delete settings.api_key; // Don't send actual key
    }
    
    res.json(settings);
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update API settings
router.put('/api', async (req, res) => {
  try {
    const { provider, apiKey, model, baseUrl } = req.body;
    
    if (provider) {
      await updateSetting('api_provider', provider);
    }
    
    if (apiKey) {
      // Encrypt API key before storing
      const encryptedKey = encrypt(apiKey);
      await updateSetting('api_key', encryptedKey);
    }
    
    if (model) {
      await updateSetting('api_model', model);
    }
    
    if (baseUrl) {
      await updateSetting('api_base_url', baseUrl);
    }
    
    res.json({ success: true, message: 'API settings updated' });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Test API connection
router.post('/test-api', async (req, res) => {
  try {
    const { provider, apiKey, model, baseUrl } = req.body;
    
    const result = await testLLMConnection({
      provider,
      apiKey,
      model,
      baseUrl
    });
    
    res.json(result);
  } catch (error) {
    console.error('API test error:', error);
    res.status(500).json({ 
      success: false, 
      error: error.message || 'Connection test failed' 
    });
  }
});

module.exports = router;
```

### 3.4 Health Check Endpoint

```javascript
// server/routes/health.js

const express = require('express');
const router = express.Router();
const { getSheet } = require('../services/googleSheets');
const { getProviderConfig } = require('../services/llmService');

router.get('/', async (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check Google Sheets connection
  try {
    await getSheet('settings');
    status.services.googleSheets = 'connected';
  } catch (error) {
    status.services.googleSheets = 'disconnected';
    status.status = 'degraded';
  }

  // Check LLM configuration
  try {
    const config = await getProviderConfig();
    status.services.llm = {
      status: config.apiKey ? 'configured' : 'not_configured',
      provider: config.provider,
      model: config.model
    };
    if (!config.apiKey) status.status = 'degraded';
  } catch (error) {
    status.services.llm = { status: 'error', error: error.message };
    status.status = 'degraded';
  }

  const httpStatus = status.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(status);
});

module.exports = router;
```

### 3.5 Multi-Provider LLM Service

```javascript
// server/services/llmService.js

const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { getSetting } = require('./googleSheets');
const { decrypt } = require('../middleware/encryption');

// Provider configurations (simplified - Anthropic + OpenAI-compatible covers most use cases)
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307', 'claude-3-opus-20240229']
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'anthropic/claude-3-sonnet',
    models: ['anthropic/claude-3-sonnet', 'openai/gpt-4o', 'google/gemini-pro']
  },
  custom: {
    name: 'Custom/Local (OpenAI-compatible)',
    defaultModel: '',
    models: []
  }
};

// Retry helper for resilient API calls
async function withRetry(fn, retries = 3, delayMs = 1000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) throw error;

      // Exponential backoff
      const delay = delayMs * Math.pow(2, attempt);
      console.warn(`API call failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

async function getProviderConfig() {
  const provider = await getSetting('api_provider') || 'anthropic';
  const encryptedKey = await getSetting('api_key');
  const apiKey = encryptedKey ? decrypt(encryptedKey) : process.env.ANTHROPIC_API_KEY;
  const model = await getSetting('api_model') || PROVIDERS[provider]?.defaultModel;
  const baseUrl = await getSetting('api_base_url');
  
  return { provider, apiKey, model, baseUrl };
}

async function sendMessage(userMessage, conversationHistory, knowledgeBase, systemPrompt) {
  const config = await getProviderConfig();

  // Use retry wrapper for resilience
  return withRetry(async () => {
    switch (config.provider) {
      case 'anthropic':
        return sendAnthropicMessage(config, userMessage, conversationHistory, knowledgeBase, systemPrompt);
      case 'openai':
      case 'openrouter':
      case 'custom':
        return sendOpenAICompatibleMessage(config, userMessage, conversationHistory, knowledgeBase, systemPrompt);
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
  });
}

async function sendAnthropicMessage(config, userMessage, conversationHistory, knowledgeBase, systemPrompt) {
  const client = new Anthropic({ apiKey: config.apiKey });
  
  // Build messages array from history
  const messages = conversationHistory.map(msg => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));
  
  // Add current message
  messages.push({ role: 'user', content: userMessage });
  
  const response = await client.messages.create({
    model: config.model,
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages
  });
  
  return response.content[0].text;
}

async function sendOpenAICompatibleMessage(config, userMessage, conversationHistory, knowledgeBase, systemPrompt) {
  const clientConfig = { apiKey: config.apiKey };
  
  if (config.provider === 'openrouter') {
    clientConfig.baseURL = 'https://openrouter.ai/api/v1';
  } else if (config.baseUrl) {
    clientConfig.baseURL = config.baseUrl;
  }
  
  const client = new OpenAI(clientConfig);
  
  // Build messages array
  const messages = [
    { role: 'system', content: systemPrompt }
  ];
  
  conversationHistory.forEach(msg => {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content
    });
  });
  
  messages.push({ role: 'user', content: userMessage });
  
  const response = await client.chat.completions.create({
    model: config.model,
    messages: messages,
    max_tokens: 2048
  });
  
  return response.choices[0].message.content;
}

async function testLLMConnection(config) {
  try {
    const testMessage = 'Hello, this is a connection test. Please respond with "Connection successful!"';
    
    let response;
    switch (config.provider) {
      case 'anthropic':
        const anthropic = new Anthropic({ apiKey: config.apiKey });
        const anthropicResp = await anthropic.messages.create({
          model: config.model || 'claude-sonnet-4-20250514',
          max_tokens: 100,
          messages: [{ role: 'user', content: testMessage }]
        });
        response = anthropicResp.content[0].text;
        break;
        
      case 'openai':
      case 'openrouter':
      case 'custom':
        const clientConfig = { apiKey: config.apiKey };
        if (config.provider === 'openrouter') {
          clientConfig.baseURL = 'https://openrouter.ai/api/v1';
        } else if (config.baseUrl) {
          clientConfig.baseURL = config.baseUrl;
        }
        const openai = new OpenAI(clientConfig);
        const openaiResp = await openai.chat.completions.create({
          model: config.model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: testMessage }],
          max_tokens: 100
        });
        response = openaiResp.choices[0].message.content;
        break;
        
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
    
    return {
      success: true,
      message: 'Connection successful',
      response: response.substring(0, 100)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

function getAvailableProviders() {
  return PROVIDERS;
}

module.exports = {
  sendMessage,
  testLLMConnection,
  getAvailableProviders,
  getProviderConfig
};
```

### 3.5 Encryption Middleware

```javascript
// server/middleware/encryption.js

const crypto = require('crypto');

// SECURITY: Require encryption key from environment - no fallback
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  throw new Error('ENCRYPTION_KEY environment variable must be exactly 32 characters');
}

const IV_LENGTH = 16;

function encrypt(text) {
  if (!text) return '';
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);
  
  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

function decrypt(text) {
  if (!text) return '';
  
  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    
    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error);
    return '';
  }
}

module.exports = { encrypt, decrypt };
```

### 3.6 Admin Settings Page Component

```jsx
// client/src/pages/AdminSettings.jsx

import React, { useState, useEffect } from 'react';
import ApiSettings from '../components/admin/ApiSettings';
import KnowledgeBaseManager from '../components/admin/KnowledgeBaseManager';
import AnalyticsDashboard from '../components/admin/AnalyticsDashboard';
import { settingsApi } from '../services/api';

const AdminSettings = () => {
  const [activeTab, setActiveTab] = useState('analytics');

  return (
    <div className="admin-settings-container">
      <header>
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
          className={activeTab === 'knowledge' ? 'active' : ''}
          onClick={() => setActiveTab('knowledge')}
        >
          Knowledge Base
        </button>
      </nav>

      <main className="settings-content">
        {activeTab === 'analytics' && <AnalyticsDashboard />}
        {activeTab === 'api' && <ApiSettings />}
        {activeTab === 'knowledge' && <KnowledgeBaseManager />}
      </main>
    </div>
  );
};

export default AdminSettings;
```

### 3.7 Analytics Dashboard Component

```jsx
// client/src/components/admin/AnalyticsDashboard.jsx

import React, { useState, useEffect } from 'react';
import { ticketApi } from '../../services/api';

const AnalyticsDashboard = () => {
  const [stats, setStats] = useState({
    ticketsToday: 0,
    ticketsOpen: 0,
    avgResolutionHours: 0,
    topApplication: { name: 'N/A', percentage: 0 }
  });
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
    return <div className="analytics-loading">Loading analytics...</div>;
  }

  return (
    <div className="analytics-dashboard">
      <h2>Ticket Analytics</h2>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-value">{stats.ticketsToday}</div>
          <div className="stat-label">Tickets Created Today</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.ticketsOpen}</div>
          <div className="stat-label">Open Tickets</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.avgResolutionHours.toFixed(1)}h</div>
          <div className="stat-label">Avg Resolution Time</div>
        </div>

        <div className="stat-card">
          <div className="stat-value">{stats.topApplication.name}</div>
          <div className="stat-label">
            Most Common App ({stats.topApplication.percentage}%)
          </div>
        </div>
      </div>

      <button className="refresh-btn" onClick={loadStats}>
        Refresh Stats
      </button>
    </div>
  );
};

export default AnalyticsDashboard;
```

### 3.7 API Settings Component

```jsx
// client/src/components/admin/ApiSettings.jsx

import React, { useState, useEffect } from 'react';
import { settingsApi } from '../../services/api';

const PROVIDERS = [
  { id: 'anthropic', name: 'Anthropic (Claude)', models: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307', 'claude-3-opus-20240229'] },
  { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo'] },
  { id: 'openrouter', name: 'OpenRouter', models: ['anthropic/claude-3-sonnet', 'openai/gpt-4o', 'google/gemini-pro'] },
  { id: 'custom', name: 'Custom/Local (OpenAI-compatible)', models: [] }
];

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
        apiKey: '', // Never pre-fill API key
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
      setSettings({ ...settings, apiKey: '' }); // Clear API key from form
      loadSettings(); // Reload to get masked key
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
        apiKey: settings.apiKey || undefined // Use existing key if not provided
      });
      
      if (result.success) {
        setMessage({ type: 'success', text: `Connection successful! Response: "${result.response}"` });
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
        <div className={`message ${message.type}`}>
          {message.text}
        </div>
      )}
      
      <div className="form-group">
        <label htmlFor="provider">API Provider</label>
        <select 
          id="provider"
          value={settings.provider}
          onChange={handleProviderChange}
        >
          {PROVIDERS.map(provider => (
            <option key={provider.id} value={provider.id}>
              {provider.name}
            </option>
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
        <button 
          className="btn-secondary"
          onClick={handleTestConnection}
          disabled={isTesting}
        >
          {isTesting ? 'Testing...' : 'Test Connection'}
        </button>
        <button 
          className="btn-primary"
          onClick={handleSave}
          disabled={isLoading}
        >
          {isLoading ? 'Saving...' : 'Save Settings'}
        </button>
      </div>
    </div>
  );
};

export default ApiSettings;
```

### 3.8 API Service (Frontend)

```javascript
// client/src/services/api.js

const API_BASE = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

// Settings API
export const settingsApi = {
  getSettings: async () => {
    const response = await fetch(`${API_BASE}/settings`);
    if (!response.ok) throw new Error('Failed to fetch settings');
    return response.json();
  },
  
  updateApiSettings: async (settings) => {
    const response = await fetch(`${API_BASE}/settings/api`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!response.ok) throw new Error('Failed to update settings');
    return response.json();
  },
  
  testApiConnection: async (settings) => {
    const response = await fetch(`${API_BASE}/settings/test-api`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings)
    });
    if (!response.ok) throw new Error('Connection test failed');
    return response.json();
  }
};

// Chat API
export const chatApi = {
  sendMessage: async (sessionId, message) => {
    const response = await fetch(`${API_BASE}/chat/message`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, message })
    });
    if (!response.ok) throw new Error('Failed to send message');
    return response.json();
  },
  
  getSession: async (sessionId) => {
    const response = await fetch(`${API_BASE}/chat/session/${sessionId}`);
    if (!response.ok) throw new Error('Failed to fetch session');
    return response.json();
  },
  
  checkNotifications: async (sessionId) => {
    const response = await fetch(`${API_BASE}/chat/notifications/${sessionId}`);
    if (!response.ok) throw new Error('Failed to check notifications');
    return response.json();
  },
  
  markAsRead: async (sessionId) => {
    const response = await fetch(`${API_BASE}/chat/mark-read`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId })
    });
    if (!response.ok) throw new Error('Failed to mark as read');
    return response.json();
  },

  // NEW: Export chat transcript
  exportTranscript: async (sessionId) => {
    const response = await fetch(`${API_BASE}/chat/export/${sessionId}`);
    if (!response.ok) throw new Error('Failed to export transcript');
    const blob = await response.blob();
    // Trigger download
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

// Ticket API
export const ticketApi = {
  getTickets: async (status) => {
    const url = status
      ? `${API_BASE}/tickets?status=${status}`
      : `${API_BASE}/tickets`;
    const response = await fetch(url, {
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch tickets');
    return response.json();
  },

  getTicket: async (ticketId) => {
    const response = await fetch(`${API_BASE}/tickets/${ticketId}`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch ticket');
    return response.json();
  },

  updateTicket: async (ticketId, updates) => {
    const response = await fetch(`${API_BASE}/tickets/${ticketId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify(updates)
    });
    if (!response.ok) throw new Error('Failed to update ticket');
    return response.json();
  },

  askClarification: async (ticketId, question) => {
    const response = await fetch(`${API_BASE}/tickets/${ticketId}/clarify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...getAuthHeaders() },
      body: JSON.stringify({ question })
    });
    if (!response.ok) throw new Error('Failed to send clarification');
    return response.json();
  },

  // NEW: Get analytics for admin dashboard
  getAnalytics: async () => {
    const response = await fetch(`${API_BASE}/tickets/analytics`, {
      headers: getAuthHeaders()
    });
    if (!response.ok) throw new Error('Failed to fetch analytics');
    return response.json();
  }
};

// Auth helpers
function getAuthHeaders() {
  const credentials = localStorage.getItem('auth_credentials');
  if (!credentials) return {};
  return { Authorization: `Basic ${credentials}` };
}

export const authApi = {
  login: async (role, password) => {
    const credentials = btoa(`${role}:${password}`);
    // Test the credentials by hitting a protected endpoint
    const response = await fetch(`${API_BASE}/settings`, {
      headers: { Authorization: `Basic ${credentials}` }
    });
    if (response.ok) {
      localStorage.setItem('auth_credentials', credentials);
      localStorage.setItem('auth_role', role);
      return { success: true };
    }
    return { success: false, error: 'Invalid credentials' };
  },

  logout: () => {
    localStorage.removeItem('auth_credentials');
    localStorage.removeItem('auth_role');
  },

  getRole: () => localStorage.getItem('auth_role'),

  isAuthenticated: () => !!localStorage.getItem('auth_credentials')
};

// Knowledge Base API
export const knowledgeApi = {
  getDocuments: async () => {
    const response = await fetch(`${API_BASE}/knowledge`);
    if (!response.ok) throw new Error('Failed to fetch documents');
    return response.json();
  },
  
  addDocument: async (doc) => {
    const response = await fetch(`${API_BASE}/knowledge`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });
    if (!response.ok) throw new Error('Failed to add document');
    return response.json();
  },
  
  updateDocument: async (docId, doc) => {
    const response = await fetch(`${API_BASE}/knowledge/${docId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc)
    });
    if (!response.ok) throw new Error('Failed to update document');
    return response.json();
  },
  
  deleteDocument: async (docId) => {
    const response = await fetch(`${API_BASE}/knowledge/${docId}`, {
      method: 'DELETE'
    });
    if (!response.ok) throw new Error('Failed to delete document');
    return response.json();
  }
};
```

---

## Part 4: Mock Data Setup

### 4.1 Mock Logs (Pre-populate in Google Sheet)

| log_id | application | error_pattern | log_content | suggested_fix |
|--------|-------------|---------------|-------------|---------------|
| log_01 | Attendance | gps, location, coordinates | [2024-01-15 09:23:11] ERROR: GPS_LOCATION_FAILED<br>[2024-01-15 09:23:11] DEBUG: LocationManager.getLastKnownLocation returned null<br>[2024-01-15 09:23:12] WARN: Fallback to network location failed<br>[2024-01-15 09:23:12] ERROR: Unable to determine user coordinates | GPS permission issue. Guide user to: Settings → Apps → Attendance → Permissions → Enable "Location" with "Always Allow" option. If issue persists, clear app cache. |
| log_02 | Attendance | login, auth, timeout, ldap | [2024-01-15 10:45:22] INFO: Login attempt for user_id=3847<br>[2024-01-15 10:45:22] DEBUG: Connecting to LDAP server<br>[2024-01-15 10:45:52] ERROR: LDAP_CONNECTION_TIMEOUT after 30000ms<br>[2024-01-15 10:45:52] ERROR: AUTH_FAILED: Unable to verify creds | LDAP authentication timeout. Check if user is connected to corporate network (VPN if remote). If on VPN, try disconnecting and reconnecting. Escalate to IT if persists. |
| log_03 | Delivery | sync, update, status, refresh | [2024-01-15 14:22:33] INFO: Sync initiated for order_id=ORD-98234<br>[2024-01-15 14:22:33] WARN: Backend response delayed >5000ms<br>[2024-01-15 14:22:38] ERROR: SYNC_TIMEOUT: Status update failed<br>[2024-01-15 14:22:38] INFO: Queued for retry in 15 minutes | Backend sync delay. The delivery status sync runs every 15 minutes. User should pull-to-refresh. If status unchanged after 30 minutes, check with warehouse team for physical confirmation of dispatch. |
| log_04 | Delivery | crash, photo, upload, memory | [2024-01-15 16:05:11] INFO: Camera intent launched<br>[2024-01-15 16:05:15] DEBUG: Photo captured, size: 4.2MB<br>[2024-01-15 16:05:16] ERROR: OutOfMemoryError during image compress<br>[2024-01-15 16:05:16] FATAL: Application crashed - heap exhausted | Memory issue when processing large photos. User should: 1) Close other apps before uploading 2) Reduce camera resolution in phone settings 3) Clear app cache. Dev team should optimize image compression in next release. |
| log_05 | Inventory | barcode, scan, camera, read | [2024-01-15 11:30:45] INFO: Barcode scan initiated<br>[2024-01-15 11:30:46] WARN: AutoFocus failed, retrying...<br>[2024-01-15 11:30:48] ERROR: BARCODE_READ_FAILED after 3 attempts<br>[2024-01-15 11:30:48] DEBUG: Camera focus distance: infinity | Camera focus issue for barcode scanning. User should: 1) Clean camera lens 2) Ensure adequate lighting 3) Hold phone 6-8 inches from barcode 4) Try manual entry if scan continues to fail. Check if barcode label is damaged. |

### 4.2 Sample Knowledge Base Documents

#### Document 1: Attendance App Troubleshooting

```markdown
# Attendance App - Troubleshooting Guide

## GPS/Location Issues

### Problem: "GPS coordinates not found" or "Unable to determine location"
**Symptoms:** Cannot check in, app shows location error, map shows wrong position
**Common Causes:** Location services disabled, app lacks GPS permission, poor GPS signal indoors

**Solution Steps:**
1. Open phone Settings → Apps → Attendance App
2. Tap Permissions → Location
3. Select "Allow all the time" (Android) or "Always" (iOS)
4. Enable "Use precise location" if available
5. Restart the Attendance app
6. If indoors, move near a window or step outside briefly

**If issue persists:** Check if phone's GPS works in Google Maps. If Maps also fails, this is a device issue, not an app issue.

### Problem: Check-in location shows wrong address
**Symptoms:** GPS works but recorded location is incorrect by several meters
**Common Causes:** GPS drift, cached old location, poor satellite visibility

**Solution Steps:**
1. Close the Attendance app completely
2. Open Google Maps, wait for blue dot to stabilize
3. Walk around briefly to refresh GPS
4. Return to Attendance app and try again
5. Ensure you're not in a basement or surrounded by tall buildings

## Login Issues

### Problem: "Invalid credentials" error
**Symptoms:** Cannot login despite correct password
**Common Causes:** Caps lock, expired password, account locked

**Solution Steps:**
1. Verify Caps Lock is off
2. Try logging into the web portal to confirm password works
3. If password was recently changed, use the new password
4. After 5 failed attempts, account locks for 15 minutes - wait and retry
5. Contact IT if still unable to login after 30 minutes

### Problem: "Session expired" keeps appearing
**Symptoms:** Logged out frequently, need to re-login multiple times per day
**Common Causes:** App running in background is being killed, unstable internet

**Solution Steps:**
1. Disable battery optimization for Attendance app
2. Settings → Apps → Attendance → Battery → Don't optimize
3. Ensure stable internet connection when using the app
```

#### Document 2: Delivery App FAQ

```markdown
# Delivery App - Frequently Asked Questions

## Order Tracking

### Q: Why hasn't my delivery status updated?
The delivery status syncs with our system every 15 minutes. If your status hasn't changed:
1. Pull down to refresh the tracking screen
2. Wait at least 30 minutes before reporting an issue
3. During peak hours (10am-2pm, 6pm-9pm), updates may be delayed up to 1 hour
4. If still not updated after 1 hour, contact support

### Q: What do the delivery statuses mean?
- **Order Placed:** We received your order
- **Processing:** Warehouse is preparing your items
- **Dispatched:** Driver has picked up your package
- **Out for Delivery:** Driver is en route to your location
- **Delivered:** Package was dropped off
- **Delivery Attempted:** Driver tried but couldn't complete delivery

### Q: The app shows "Delivered" but I didn't receive my package
1. Check with family members, neighbors, or building security
2. Look for a delivery photo in the app (tap on the order)
3. Check alternative drop-off locations (back door, garage)
4. If still not found, report within 24 hours through the app

## App Issues

### Q: App crashes when I try to upload proof of delivery photo
This usually happens when the photo file is too large:
1. Close other running apps to free up memory
2. In your phone's camera settings, reduce photo resolution
3. Clear the Delivery app cache: Settings → Apps → Delivery → Clear Cache
4. Try again with the camera app in "Standard" mode (not HDR)

### Q: I can't see my past orders
Past orders are visible for 90 days. If recent orders are missing:
1. Check you're logged into the correct account
2. Pull down to refresh the order history
3. Check internet connection
4. Log out and log back in
```

---

## Part 5: AI Prompts

### 5.1 System Prompt (Main)

```javascript
// server/prompts/systemPrompt.js

const getSystemPrompt = (knowledgeBaseDocs) => `
You are a helpful IT support assistant for a company's internal applications. Your role is to help employees troubleshoot issues with company applications.

## Your Capabilities
1. Answer questions about company applications based on the knowledge base provided
2. Guide users through troubleshooting steps
3. Collect information about issues that require IT support intervention
4. Create support tickets for issues you cannot resolve

## Supported Applications
- Attendance App (check-in, GPS tracking, leave management)
- Delivery App (order tracking, proof of delivery, driver management)
- Inventory App (barcode scanning, stock management)

## Behavior Rules

### STRICT BOUNDARIES
- Only answer questions related to the supported applications listed above
- If asked about anything unrelated (weather, general knowledge, personal advice, other topics), respond with:
  "I'm sorry, I am a trouble ticketing assistant for company applications. I can only help with issues related to the Attendance App, Delivery App, or Inventory App. How can I help you with one of these applications today?"

### When User Reports an Issue
1. First, check if the issue can be resolved using the knowledge base below
2. If yes, provide the solution and ask if it resolved the issue
3. If no solution exists in KB, OR if the user confirms the KB solution didn't work:
   - Collect: Application name, what happened, when it happened, any error messages
   - **ASK FOR CONFIRMATION** before creating a ticket:
     "I couldn't find a solution in our knowledge base. Would you like me to create a support ticket so our IT team can investigate? Just say 'yes' to create a ticket, or let me know if you'd like to try something else first."
   - Only after user confirms, respond with: [CREATE_TICKET] followed by a JSON summary

### Ticket Creation Format
When you need to create a ticket, end your message with:
[CREATE_TICKET]
{
  "application": "app name",
  "problem_summary": "brief one-line summary",
  "problem_details": "detailed description from user",
  "error_pattern": "keywords for log matching"
}

### Tone
- Be friendly and professional
- Use simple, non-technical language
- Be concise - users are likely frustrated and want quick solutions
- Show empathy but stay focused on resolution

## Knowledge Base Documents
${knowledgeBaseDocs}

---
Remember: Only help with company applications. Create tickets when KB doesn't have a solution.
`;

module.exports = { getSystemPrompt };
```

### 5.2 IT Support Context Prompt

```javascript
// server/prompts/supportPrompt.js

const getITSupportPrompt = (ticketInfo, logContent) => `
You are assisting IT support staff with analyzing a support ticket.

## Ticket Information
- Ticket ID: ${ticketInfo.ticket_id}
- Application: ${ticketInfo.application}
- Problem Summary: ${ticketInfo.problem_summary}
- Problem Details: ${ticketInfo.problem_details}
- Reported At: ${ticketInfo.reported_at}

## Associated Log Output
${logContent}

## Your Task
1. Analyze the log output
2. Identify the root cause
3. Provide a clear, actionable suggested fix
4. If you need more information from the user, specify exactly what questions to ask

Format your response as:

**Root Cause Analysis:**
[Your analysis]

**Suggested Fix:**
[Step-by-step resolution]

**Additional Information Needed (if any):**
[Questions for the user]
`;

module.exports = { getITSupportPrompt };
```

---

## Part 6: API Endpoints

### 6.1 Backend Routes

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              API ENDPOINTS                                  │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  CHAT ENDPOINTS (User-facing)                                               │
│  ─────────────────────────────────────────────────────────────────────────  │
│  POST   /api/chat/message         Send message, get AI response             │
│  GET    /api/chat/session/:id     Get all messages for a session            │
│  GET    /api/chat/notifications   Check for unread messages (bell icon)     │
│  POST   /api/chat/mark-read       Mark messages as read                     │
│  GET    /api/chat/export/:id      Export chat transcript as text file       │
│                                                                             │
│  TICKET ENDPOINTS (IT Support)                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/tickets              List all tickets (filterable by status)   │
│  GET    /api/tickets/:id          Get single ticket with full details       │
│  PATCH  /api/tickets/:id          Update ticket status                      │
│  POST   /api/tickets/:id/clarify  Send clarification question to user       │
│  GET    /api/tickets/analytics    Get ticket statistics for dashboard       │
│                                                                             │
│  KNOWLEDGE BASE ENDPOINTS (Admin)                                           │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/knowledge            List all KB documents                     │
│  POST   /api/knowledge            Add new KB document                       │
│  PUT    /api/knowledge/:id        Update KB document                        │
│  DELETE /api/knowledge/:id        Delete KB document                        │
│                                                                             │
│  SETTINGS ENDPOINTS (Admin)                                                 │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/settings             Get all settings (API key masked)         │
│  PUT    /api/settings/api         Update API provider and key               │
│  POST   /api/settings/test-api    Test API connection                       │
│                                                                             │
│  UTILITY ENDPOINTS                                                          │
│  ─────────────────────────────────────────────────────────────────────────  │
│  GET    /api/health               Health check (sheets + LLM status)        │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 6.2 Key API Implementation

```javascript
// server/routes/chat.js

const express = require('express');
const router = express.Router();
const { sendMessage } = require('../services/llmService');
const { getSystemPrompt } = require('../prompts/systemPrompt');
const { 
  addMessage, 
  getMessagesBySession, 
  getUnreadMessages,
  createTicket,
  getKnowledgeBase 
} = require('../services/googleSheets');
const { matchMockLog } = require('../services/mockLogs');
const { v4: uuidv4 } = require('uuid');

// Send message and get AI response
router.post('/message', async (req, res) => {
  try {
    const { sessionId, message } = req.body;
    
    // Get conversation history
    const history = await getMessagesBySession(sessionId);
    
    // Get knowledge base for context
    const knowledgeBase = await getKnowledgeBase();
    const kbContent = knowledgeBase.map(doc => 
      `### ${doc.title}\n${doc.content}`
    ).join('\n\n---\n\n');
    
    // Build system prompt with KB
    const systemPrompt = getSystemPrompt(kbContent);
    
    // Save user message
    await addMessage({
      message_id: uuidv4(),
      session_id: sessionId,
      ticket_id: '',
      sender: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      read: 'TRUE'
    });
    
    // Get AI response using configured provider
    const aiResponse = await sendMessage(message, history, knowledgeBase, systemPrompt);
    
    // Check if AI wants to create a ticket
    let ticketCreated = null;
    if (aiResponse.includes('[CREATE_TICKET]')) {
      const ticketData = extractTicketData(aiResponse);
      const mockLog = matchMockLog(ticketData.application, ticketData.error_pattern);
      
      ticketCreated = await createTicket({
        ticket_id: `TKT-${Date.now().toString().slice(-5)}`,
        session_id: sessionId,
        status: 'open',
        application: ticketData.application,
        problem_summary: ticketData.problem_summary,
        problem_details: ticketData.problem_details,
        reported_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        assigned_log: mockLog?.log_id || '',
        suggested_fix: mockLog?.suggested_fix || 'Requires manual analysis',
        it_notes: '',
        resolved_at: ''
      });
    }
    
    // Clean response (remove ticket JSON) and save
    const cleanResponse = aiResponse.replace(/\[CREATE_TICKET\][\s\S]*$/, '').trim();
    
    await addMessage({
      message_id: uuidv4(),
      session_id: sessionId,
      ticket_id: ticketCreated?.ticket_id || '',
      sender: 'ai',
      content: cleanResponse + (ticketCreated ? `\n\nI've created ticket **${ticketCreated.ticket_id}** for you. Our IT team will look into this.` : ''),
      timestamp: new Date().toISOString(),
      read: 'TRUE'
    });
    
    res.json({
      response: cleanResponse,
      ticket: ticketCreated
    });
    
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message' });
  }
});

// Helper function to extract ticket data from AI response
function extractTicketData(response) {
  const jsonMatch = response.match(/\[CREATE_TICKET\]\s*(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('Failed to parse ticket JSON:', e);
    }
  }
  return {
    application: 'Unknown',
    problem_summary: 'Issue reported by user',
    problem_details: response,
    error_pattern: ''
  };
}

// Check for notifications
router.get('/notifications/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const unreadMessages = await getUnreadMessages(sessionId);
    res.json({ 
      hasNotifications: unreadMessages.length > 0,
      count: unreadMessages.length
    });
  } catch (error) {
    res.status(500).json({ error: 'Failed to check notifications' });
  }
});

// Get session messages
router.get('/session/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await getMessagesBySession(sessionId);
    res.json(messages);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

// Mark messages as read
router.post('/mark-read', async (req, res) => {
  try {
    const { sessionId } = req.body;
    // Implementation: Update all unread messages for this session
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

// Export chat transcript as text file
router.get('/export/:sessionId', async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await getMessagesBySession(sessionId);

    if (messages.length === 0) {
      return res.status(404).json({ error: 'No messages found' });
    }

    // Format messages as readable text
    const transcript = messages.map(msg => {
      const sender = msg.sender === 'user' ? 'You' :
                     msg.sender === 'ai' ? 'IT Assistant' : 'IT Support';
      const time = new Date(msg.timestamp).toLocaleString();
      return `[${time}] ${sender}:\n${msg.content}\n`;
    }).join('\n---\n\n');

    const header = `IT Support Chat Transcript\nSession: ${sessionId}\nExported: ${new Date().toLocaleString()}\n${'='.repeat(50)}\n\n`;

    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="chat-transcript-${sessionId}.txt"`);
    res.send(header + transcript);
  } catch (error) {
    console.error('Export error:', error);
    res.status(500).json({ error: 'Failed to export transcript' });
  }
});

module.exports = router;
```

### 6.3 Tickets API Implementation

```javascript
// server/routes/tickets.js

const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { ticketUpdateRules, validateRequest } = require('../middleware/validate');
const {
  getTicketsByStatus,
  getTicketById,
  updateTicket,
  addMessage,
  getAllTickets
} = require('../services/googleSheets');
const { v4: uuidv4 } = require('uuid');

// Apply auth to all ticket routes
router.use(requireRole('it_support'));

// Get tickets (with optional status filter)
router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const tickets = status
      ? await getTicketsByStatus(status)
      : await getAllTickets();
    res.json(tickets);
  } catch (error) {
    console.error('Get tickets error:', error);
    res.status(500).json({ error: 'Failed to fetch tickets' });
  }
});

// Get analytics for dashboard
router.get('/analytics', async (req, res) => {
  try {
    const tickets = await getAllTickets();
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Calculate stats
    const ticketsToday = tickets.filter(t =>
      new Date(t.reported_at) >= today
    ).length;

    const ticketsOpen = tickets.filter(t =>
      ['open', 'waiting_clarification', 'waiting_confirmation'].includes(t.status)
    ).length;

    // Calculate average resolution time (for closed tickets)
    const closedTickets = tickets.filter(t => t.status === 'closed' && t.resolved_at);
    let avgResolutionHours = 0;
    if (closedTickets.length > 0) {
      const totalHours = closedTickets.reduce((sum, t) => {
        const reported = new Date(t.reported_at);
        const resolved = new Date(t.resolved_at);
        return sum + (resolved - reported) / (1000 * 60 * 60);
      }, 0);
      avgResolutionHours = totalHours / closedTickets.length;
    }

    // Find most common application
    const appCounts = {};
    tickets.forEach(t => {
      appCounts[t.application] = (appCounts[t.application] || 0) + 1;
    });
    const topApp = Object.entries(appCounts)
      .sort((a, b) => b[1] - a[1])[0];
    const topApplication = topApp
      ? { name: topApp[0], percentage: Math.round((topApp[1] / tickets.length) * 100) }
      : { name: 'N/A', percentage: 0 };

    res.json({
      ticketsToday,
      ticketsOpen,
      avgResolutionHours,
      topApplication
    });
  } catch (error) {
    console.error('Analytics error:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// Get single ticket
router.get('/:id', async (req, res) => {
  try {
    const ticket = await getTicketById(req.params.id);
    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }
    res.json(ticket);
  } catch (error) {
    res.status(500).json({ error: 'Failed to fetch ticket' });
  }
});

// Update ticket
router.patch('/:id', ticketUpdateRules, validateRequest, async (req, res) => {
  try {
    const { status, it_notes } = req.body;
    const updates = {
      updated_at: new Date().toISOString()
    };

    if (status) updates.status = status;
    if (it_notes) updates.it_notes = it_notes;
    if (status === 'closed') updates.resolved_at = new Date().toISOString();

    const updated = await updateTicket(req.params.id, updates);
    res.json(updated);
  } catch (error) {
    res.status(500).json({ error: 'Failed to update ticket' });
  }
});

// Send clarification question to user
router.post('/:id/clarify', async (req, res) => {
  try {
    const { question } = req.body;
    const ticket = await getTicketById(req.params.id);

    if (!ticket) {
      return res.status(404).json({ error: 'Ticket not found' });
    }

    // Add IT support message to the session
    await addMessage({
      message_id: uuidv4(),
      session_id: ticket.session_id,
      ticket_id: ticket.ticket_id,
      sender: 'it_support',
      content: question,
      timestamp: new Date().toISOString(),
      read: 'FALSE'  // Will trigger notification bell
    });

    // Update ticket status
    await updateTicket(ticket.ticket_id, {
      status: 'waiting_clarification',
      updated_at: new Date().toISOString()
    });

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: 'Failed to send clarification' });
  }
});

module.exports = router;
```

---

## Part 7: Frontend Components

### 7.1 User Chat Interface

```jsx
// client/src/pages/UserChat.jsx

import React, { useState, useEffect, useRef } from 'react';
import ChatWindow from '../components/user/ChatWindow';
import NotificationBell from '../components/user/NotificationBell';
import { useSession } from '../context/SessionContext';
import { chatApi } from '../services/api';

// Conversation starters for empty chat
const CONVERSATION_STARTERS = [
  { icon: '📍', text: "My Attendance app won't find my location" },
  { icon: '📦', text: "Delivery status hasn't updated" },
  { icon: '📷', text: "App crashes when I scan barcodes" },
  { icon: '🔐', text: "I can't log into the app" }
];

const UserChat = () => {
  const { sessionId } = useSession();
  const [messages, setMessages] = useState([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [hasNotification, setHasNotification] = useState(false);
  
  // Poll for notifications every 10 seconds
  useEffect(() => {
    const checkNotifications = async () => {
      const result = await chatApi.checkNotifications(sessionId);
      setHasNotification(result.hasNotifications);
    };
    
    const interval = setInterval(checkNotifications, 10000);
    checkNotifications(); // Initial check
    
    return () => clearInterval(interval);
  }, [sessionId]);
  
  // Load existing messages on mount
  useEffect(() => {
    const loadMessages = async () => {
      const history = await chatApi.getSession(sessionId);
      setMessages(history);
    };
    loadMessages();
  }, [sessionId]);
  
  const handleSend = async () => {
    if (!inputValue.trim() || isLoading) return;
    
    const userMessage = { sender: 'user', content: inputValue };
    setMessages(prev => [...prev, userMessage]);
    setInputValue('');
    setIsLoading(true);
    
    try {
      const response = await chatApi.sendMessage(sessionId, inputValue);
      setMessages(prev => [...prev, { sender: 'ai', content: response.response }]);
    } catch (error) {
      setMessages(prev => [...prev, { sender: 'ai', content: 'Sorry, something went wrong. Please try again.' }]);
    } finally {
      setIsLoading(false);
    }
  };
  
  const handleNotificationClick = async () => {
    // Refresh messages and mark as read
    const history = await chatApi.getSession(sessionId);
    setMessages(history);
    await chatApi.markAsRead(sessionId);
    setHasNotification(false);
  };
  
  // Handle clicking a conversation starter
  const handleStarterClick = (starterText) => {
    setInputValue(starterText);
  };

  // Handle exporting chat transcript
  const handleExport = async () => {
    if (messages.length === 0) return;
    await chatApi.exportTranscript(sessionId);
  };

  return (
    <div className="user-chat-container">
      <header>
        <h1>IT Support Assistant</h1>
        <div className="header-actions">
          {messages.length > 0 && (
            <button className="export-btn" onClick={handleExport} title="Export chat">
              📥 Export
            </button>
          )}
          <NotificationBell
            hasNotification={hasNotification}
            onClick={handleNotificationClick}
          />
        </div>
      </header>

      <ChatWindow
        messages={messages}
        isLoading={isLoading}
      />

      {/* Conversation starters - show when chat is empty */}
      {messages.length === 0 && (
        <div className="conversation-starters">
          <p>How can I help you today?</p>
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
      )}

      <div className="input-area">
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          onKeyPress={(e) => e.key === 'Enter' && handleSend()}
          placeholder="Describe your issue..."
        />
        <button onClick={handleSend} disabled={isLoading}>
          Send
        </button>
      </div>
    </div>
  );
};

export default UserChat;
```

### 7.2 IT Support Dashboard

```jsx
// client/src/pages/ITSupport.jsx

import React, { useState, useEffect } from 'react';
import TicketList from '../components/it-support/TicketList';
import TicketDetail from '../components/it-support/TicketDetail';
import { ticketApi } from '../services/api';

// Canned responses for quick replies
const CANNED_RESPONSES = [
  {
    id: 'gps_fix',
    label: 'GPS Permission Fix',
    text: 'Please try these steps:\n1. Go to Settings → Apps → Attendance\n2. Tap Permissions → Location\n3. Select "Allow all the time"\n4. Restart the app and try again'
  },
  {
    id: 'clear_cache',
    label: 'Clear Cache Instructions',
    text: 'Please clear the app cache:\n1. Go to Settings → Apps → [App Name]\n2. Tap Storage\n3. Tap "Clear Cache" (not Clear Data)\n4. Restart the app'
  },
  {
    id: 'vpn_reconnect',
    label: 'VPN Reconnection Steps',
    text: 'Please try reconnecting to VPN:\n1. Disconnect from the current VPN session\n2. Wait 10 seconds\n3. Reconnect to the corporate VPN\n4. Try the app again once connected'
  },
  {
    id: 'app_update',
    label: 'Update App',
    text: 'Please ensure you have the latest version:\n1. Open the App Store/Play Store\n2. Search for the app\n3. If "Update" is available, tap it\n4. Restart your phone after updating'
  }
];

const ITSupport = () => {
  const [tickets, setTickets] = useState([]);
  const [selectedTicket, setSelectedTicket] = useState(null);
  const [filter, setFilter] = useState('open');
  
  useEffect(() => {
    const loadTickets = async () => {
      const data = await ticketApi.getTickets(filter);
      setTickets(data);
    };
    loadTickets();
    
    // Poll for updates every 15 seconds
    const interval = setInterval(loadTickets, 15000);
    return () => clearInterval(interval);
  }, [filter]);
  
  const handleStatusChange = async (ticketId, newStatus) => {
    await ticketApi.updateTicket(ticketId, { status: newStatus });
    // Refresh
    const data = await ticketApi.getTickets(filter);
    setTickets(data);
    if (selectedTicket?.ticket_id === ticketId) {
      setSelectedTicket({ ...selectedTicket, status: newStatus });
    }
  };
  
  const handleAskClarification = async (ticketId, question) => {
    await ticketApi.askClarification(ticketId, question);
    handleStatusChange(ticketId, 'waiting_clarification');
  };
  
  return (
    <div className="it-support-container">
      <aside className="ticket-sidebar">
        <h2>Support Tickets</h2>
        <div className="filter-tabs">
          <button 
            className={filter === 'open' ? 'active' : ''} 
            onClick={() => setFilter('open')}
          >
            Open
          </button>
          <button 
            className={filter === 'waiting_clarification' ? 'active' : ''} 
            onClick={() => setFilter('waiting_clarification')}
          >
            Waiting
          </button>
          <button 
            className={filter === 'waiting_confirmation' ? 'active' : ''} 
            onClick={() => setFilter('waiting_confirmation')}
          >
            Pending Confirm
          </button>
        </div>
        <TicketList 
          tickets={tickets} 
          onSelect={setSelectedTicket}
          selectedId={selectedTicket?.ticket_id}
        />
      </aside>
      
      <main className="ticket-detail-area">
        {selectedTicket ? (
          <TicketDetail 
            ticket={selectedTicket}
            onStatusChange={handleStatusChange}
            onAskClarification={handleAskClarification}
          />
        ) : (
          <div className="no-selection">
            Select a ticket to view details
          </div>
        )}
      </main>
    </div>
  );
};

export default ITSupport;
```

### 7.3 Protected Route Component

```jsx
// client/src/components/shared/ProtectedRoute.jsx

import React from 'react';
import { Navigate } from 'react-router-dom';
import { authApi } from '../../services/api';

const ProtectedRoute = ({ children, requiredRole }) => {
  const isAuthenticated = authApi.isAuthenticated();
  const userRole = authApi.getRole();

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  // Admin can access everything, IT Support can access IT pages
  if (requiredRole === 'admin' && userRole !== 'admin') {
    return <Navigate to="/it-support" replace />;
  }

  return children;
};

export default ProtectedRoute;
```

### 7.4 Login Page

```jsx
// client/src/pages/Login.jsx

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../services/api';

const Login = () => {
  const navigate = useNavigate();
  const [role, setRole] = useState('it_support');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);

    try {
      const result = await authApi.login(role, password);
      if (result.success) {
        navigate(role === 'admin' ? '/admin/settings' : '/it-support');
      } else {
        setError('Invalid password');
      }
    } catch (err) {
      setError('Login failed. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="login-container">
      <div className="login-card">
        <h1>Staff Login</h1>
        <p>For IT Support and Admin access</p>

        {error && <div className="error-message">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="role">Role</label>
            <select
              id="role"
              value={role}
              onChange={(e) => setRole(e.target.value)}
            >
              <option value="it_support">IT Support</option>
              <option value="admin">Administrator</option>
            </select>
          </div>

          <div className="form-group">
            <label htmlFor="password">Password</label>
            <input
              type="password"
              id="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" disabled={isLoading}>
            {isLoading ? 'Logging in...' : 'Login'}
          </button>
        </form>

        <a href="/chat" className="back-link">← Back to Chat</a>
      </div>
    </div>
  );
};

export default Login;
```

### 7.5 App Router

```jsx
// client/src/App.jsx

import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SessionProvider } from './context/SessionContext';
import Sidebar from './components/shared/Sidebar';
import ProtectedRoute from './components/shared/ProtectedRoute';
import UserChat from './pages/UserChat';
import Login from './pages/Login';
import ITSupport from './pages/ITSupport';
import AdminSettings from './pages/AdminSettings';

const App = () => {
  return (
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
  );
};

export default App;
```

---

## Part 8: Implementation Sequence

### Phase 1: Foundation (Days 1-2)

```
□ Set up project structure
□ Initialize React app (Vite)
□ Initialize Node.js/Express backend
□ Set up Google Cloud project and Sheets API
□ Create Google Sheet with all tabs (including settings)
□ Implement googleSheets.js service
□ Test CRUD operations with Google Sheets
□ Set up environment variables
□ Implement encryption middleware (with proper key validation)
□ Implement input sanitization middleware
□ Implement request validation middleware
```

### Phase 2: Auth & Admin Settings (Days 3-4)

```
□ Implement simple role-based auth middleware
□ Add auth_password_hash rows to settings sheet
□ Implement settings API routes (with auth protection)
□ Build multi-provider LLM service (with retry logic)
□ Add health check endpoint
□ Build AdminSettings page
□ Build ApiSettings component
□ Build AnalyticsDashboard component
□ Implement API connection test
□ Test with Anthropic and OpenAI providers
```

### Phase 3: Core Chat (Days 5-7)

```
□ Integrate LLM service with chat
□ Create system prompt with knowledge base loading
□ Build chat API endpoints (with validation)
□ Build UserChat page with basic UI
□ Add conversation starters for empty chat
□ Implement message sending/receiving
□ Add typing indicator
□ Add chat export endpoint
□ Test end-to-end chat flow
□ Test ticket creation confirmation flow
```

### Phase 4: Ticket Flow (Days 8-10)

```
□ Implement ticket creation logic (with user confirmation)
□ Add mock logs matching
□ Build IT Support dashboard (with auth protection)
□ Build TicketList component
□ Build TicketDetail with log viewer
□ Add canned responses feature
□ Implement status change functionality
□ Add analytics endpoint
□ Test ticket lifecycle
```

### Phase 5: Notifications & Polish (Days 11-14)

```
□ Implement notification bell
□ Add clarification question flow
□ Add user confirmation flow
□ Implement knowledge base CRUD (admin)
□ Build KnowledgeBaseManager component
□ Add loading states and error handling
□ Style and polish UI (including conversation starters, canned responses)
□ Comprehensive end-to-end testing all scenarios
□ Security review (auth, sanitization, validation)
```

---

## Part 9: Test Scenarios

Run through these scenarios to validate the prototype:

### Authentication & Security Tests

| # | Scenario | Expected Outcome |
|---|----------|------------------|
| 1 | Access /it-support without auth | Returns 401 Unauthorized |
| 2 | Access /admin/settings with wrong password | Returns 403 Access Denied |
| 3 | Access /admin/settings with correct admin password | Page loads successfully |
| 4 | Submit message with XSS script tags | Tags are sanitized, no script execution |
| 5 | Submit message exceeding 5000 chars | Returns 400 validation error |

### Admin & Settings Tests

| # | Scenario | Expected Outcome |
|---|----------|------------------|
| 6 | Admin configures OpenAI as provider | Settings saved, connection test passes |
| 7 | Admin switches to Anthropic provider | Settings updated, chat uses Claude |
| 8 | Call /api/health endpoint | Returns status with sheets and LLM info |
| 9 | View analytics dashboard | Shows ticket counts, avg resolution time |

### Chat Flow Tests

| # | Scenario | Expected Outcome |
|---|----------|------------------|
| 10 | Open chat with no history | Conversation starters displayed |
| 11 | Click a conversation starter | Input field populated with starter text |
| 12 | User asks about GPS not working | AI provides solution from KB, asks if resolved |
| 13 | User says KB solution didn't work | AI asks for confirmation before creating ticket |
| 14 | User confirms ticket creation | AI creates ticket, returns ticket number |
| 15 | User asks "What's the weather today?" | AI rejects: "I can only help with company apps" |
| 16 | Export chat transcript | Downloads text file with full conversation |

### Ticket Flow Tests

| # | Scenario | Expected Outcome |
|---|----------|------------------|
| 17 | IT Support views new ticket | Sees log output and suggested fix |
| 18 | IT Support uses canned response | Pre-written text inserted into reply |
| 19 | IT Support asks clarification question | User sees bell notification |
| 20 | User clicks bell, answers question | Message saved, IT can see answer |
| 21 | IT marks ticket "waiting_confirmation" | User sees bell, can confirm fix |
| 22 | User confirms fix worked | Ticket status → closed |

### Error Handling Tests

| # | Scenario | Expected Outcome |
|---|----------|------------------|
| 23 | LLM API call fails (first attempt) | Retry succeeds, user gets response |
| 24 | LLM API call fails (all retries) | User sees friendly error message |
| 25 | Google Sheets unavailable | Health check shows degraded status |

---

## Part 10: Environment Variables

```env
# .env.example

# Server
PORT=3001
NODE_ENV=development

# Google Sheets
GOOGLE_SPREADSHEET_ID=your-spreadsheet-id
GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# Default AI Provider (can be overridden in admin settings)
ANTHROPIC_API_KEY=your-default-api-key

# Encryption (REQUIRED - exactly 32 characters)
# Generate with: node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
ENCRYPTION_KEY=

# Frontend
VITE_API_URL=http://localhost:3001/api
```

**Initial Settings Sheet Rows (add these after setup):**

| setting_key | setting_value | updated_at |
|-------------|---------------|------------|
| api_provider | anthropic | (timestamp) |
| api_key | (encrypted) | (timestamp) |
| api_model | claude-sonnet-4-20250514 | (timestamp) |
| it_support_password_hash | (sha256 hash of IT password) | (timestamp) |
| admin_password_hash | (sha256 hash of Admin password) | (timestamp) |

Generate password hashes with:
```bash
node -e "console.log(require('crypto').createHash('sha256').update('your-password').digest('hex'))"
```

---

## Part 11: Quick Start Commands

```bash
# Clone and setup
mkdir trouble-ticket-app && cd trouble-ticket-app

# Backend setup
mkdir server && cd server
npm init -y
npm install express cors dotenv uuid google-spreadsheet google-auth-library @anthropic-ai/sdk openai
npm install express-validator dompurify jsdom  # Validation & sanitization

# Frontend setup
cd ..
npm create vite@latest client -- --template react
cd client
npm install react-router-dom

# Generate encryption key
node -e "console.log('ENCRYPTION_KEY=' + require('crypto').randomBytes(16).toString('hex'))"

# Generate password hashes (replace 'your-password' with actual passwords)
node -e "console.log(require('crypto').createHash('sha256').update('it-support-password').digest('hex'))"
node -e "console.log(require('crypto').createHash('sha256').update('admin-password').digest('hex'))"

# Run development
# Terminal 1: cd server && npm run dev
# Terminal 2: cd client && npm run dev
```

---

## Part 12: Navigation Structure

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              SIDEBAR NAVIGATION                             │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  PUBLIC ROUTES                                                              │
│  ─────────────────────────────────────────────────────────────────────────  │
│  🏠  User Chat           → /chat              (Default landing page)        │
│  🔐  Login               → /login             (For IT/Admin access)         │
│                                                                             │
│  PROTECTED ROUTES (require authentication)                                  │
│  ─────────────────────────────────────────────────────────────────────────  │
│  🎫  IT Support          → /it-support        (Requires IT_SUPPORT role)    │
│                                                                             │
│  ⚙️  Admin Settings      → /admin/settings    (Requires ADMIN role)         │
│      ├── Analytics                                                          │
│      ├── API Configuration                                                  │
│      └── Knowledge Base                                                     │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Changelog (v2)

### Security Improvements
- ✅ Removed hardcoded encryption key fallback - now requires `ENCRYPTION_KEY` env var
- ✅ Added role-based authentication middleware (`auth.js`)
- ✅ Added input sanitization middleware (`sanitize.js`) using DOMPurify
- ✅ Added request validation middleware (`validate.js`) using express-validator
- ✅ Protected IT Support and Admin routes with authentication
- ✅ Added Login page and ProtectedRoute component

### UX Enhancements
- ✅ Added conversation starters for empty chat (4 common issue prompts)
- ✅ Added ticket creation confirmation - AI now asks before creating tickets
- ✅ Added chat transcript export feature (download as .txt)
- ✅ Added canned responses for IT Support quick replies
- ✅ Added Analytics dashboard with ticket statistics

### Technical Improvements
- ✅ Added retry logic with exponential backoff for LLM API calls
- ✅ Added health check endpoint (`/api/health`)
- ✅ Added analytics endpoint (`/api/tickets/analytics`)
- ✅ Simplified LLM providers (removed Google AI, kept Anthropic + OpenAI-compatible)
- ✅ Added complete tickets route implementation with all CRUD operations

### New Files Added
- `server/middleware/auth.js` - Role-based authentication
- `server/middleware/sanitize.js` - XSS protection
- `server/middleware/validate.js` - Request validation
- `server/routes/health.js` - Health check endpoint
- `client/src/pages/Login.jsx` - Staff login page
- `client/src/components/shared/ProtectedRoute.jsx` - Route protection
- `client/src/components/admin/AnalyticsDashboard.jsx` - Ticket analytics
- `client/src/components/it-support/CannedResponses.jsx` - Quick reply templates
- `client/src/components/user/ConversationStarters.jsx` - Chat prompts
- `client/src/hooks/useAuth.js` - Authentication hook
- `client/src/context/AuthContext.jsx` - Auth state management

### Updated Timeline
- Original estimate: 1.5-2 weeks
- **New estimate: 2-2.5 weeks** (accounts for security and UX additions)

---

This plan should give you everything needed to build the prototype in Claude Code. Start with Phase 1 (Foundation) to validate the data layer works, then proceed to Phase 2 (Auth & Admin Settings) to ensure authentication and the multi-provider LLM service are functional before building the chat interface.
