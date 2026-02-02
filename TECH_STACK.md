# Technology Stack Documentation

This document explains the technologies used in the IT Support Trouble Ticketing System and how each component integrates into the application.

---

## Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              FRONTEND (Port 5173)                           │
│                     React 18 + Vite + React Router DOM                      │
└─────────────────────────────────────────────────────────────────────────────┘
                                      │
                                      │ HTTP /api/* (proxied)
                                      ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (Port 3001)                            │
│                           Express.js + Node.js 18+                          │
├─────────────────────────────────────────────────────────────────────────────┤
│  Services:                                                                  │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐    │
│  │  LLM Service │  │ Google Sheets│  │Vector Service│  │Document Svc  │    │
│  │  (AI Chat)   │  │  (Database)  │  │ (Embeddings) │  │(PDF Process) │    │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘    │
└─────────┼─────────────────┼─────────────────┼─────────────────┼────────────┘
          │                 │                 │                 │
          ▼                 ▼                 ▼                 ▼
┌──────────────┐    ┌──────────────┐  ┌──────────────┐  ┌──────────────┐
│ LLM APIs     │    │ Google Sheets│  │ Embedding    │  │ Local File   │
│ (Anthropic,  │    │ API          │  │ APIs         │  │ System       │
│  OpenAI,     │    │              │  │ (OpenAI,     │  │ (vectors.json│
│  OpenRouter) │    │              │  │  Cohere,etc) │  │  uploads/)   │
└──────────────┘    └──────────────┘  └──────────────┘  └──────────────┘
```

---

## Frontend Stack

### React 18
**Purpose:** UI component library for building the interactive user interface

**Usage in this app:**
- Functional components with hooks (`useState`, `useEffect`, `useContext`)
- Context API for global state management (AuthContext, SessionContext)
- Component-based architecture for pages: UserChat, ITSupport, AdminSettings, Login

**Key files:**
- `client/src/context/AuthContext.jsx` - Authentication state management
- `client/src/context/SessionContext.jsx` - Chat session state
- `client/src/pages/*.jsx` - Page components

### Vite
**Purpose:** Fast build tool and development server

**Usage in this app:**
- Development server with hot module replacement (HMR)
- Proxies `/api` requests to backend (port 3001) during development
- Production builds with optimized bundling

**Configuration:** `client/vite.config.js`
```javascript
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true
    }
  }
}
```

### React Router DOM v6
**Purpose:** Client-side routing

**Usage in this app:**
- Route protection based on user roles
- Navigation between User Chat, IT Support Dashboard, Admin Settings
- Login/logout flow handling

---

## Backend Stack

### Node.js 18+
**Purpose:** JavaScript runtime for server-side code

**Usage in this app:**
- Requires Node 18+ for native `--watch` flag (auto-reload during development)
- ES modules support mixed with CommonJS

### Express.js 4.x
**Purpose:** Web framework for REST API

**Usage in this app:**
- RESTful API endpoints under `/api/*`
- Middleware chain: CORS → JSON parsing → Input sanitization → Routes → Error handling
- Route modules for separation of concerns

**Route structure:**
| Route | Purpose |
|-------|---------|
| `/api/chat` | AI chat interactions |
| `/api/tickets` | Ticket CRUD operations |
| `/api/settings` | App configuration |
| `/api/knowledge` | Knowledge base management |
| `/api/documents` | PDF document management |
| `/api/health` | Health check endpoint |

### Middleware Stack

**CORS** (`cors` package)
- Allows frontend origin (localhost:5173)
- Enables credentials for auth cookies

**Input Sanitization** (`dompurify` + `jsdom`)
- Sanitizes all incoming request data
- Prevents XSS attacks

**Authentication** (custom `middleware/auth.js`)
- `requireRole('admin')` - Requires admin authentication
- `requireRole('it_support')` - Requires IT support authentication
- `optionalAuth` - Attaches user info if authenticated

**Request Validation** (`express-validator`)
- Validates and sanitizes API inputs
- Returns structured validation errors

---

## Database Layer

### Google Sheets API
**Purpose:** Cloud-based database using Google Sheets as the data store

**Why Google Sheets?**
- Zero infrastructure cost
- Easy to inspect/modify data manually
- Built-in backup and version history
- Accessible via service account

**Libraries:**
- `google-spreadsheet` - High-level Google Sheets client
- `google-auth-library` - Service account authentication

**Schema (6 sheets):**

| Sheet | Purpose | Key Fields |
|-------|---------|------------|
| `tickets` | Support tickets | ticket_id, user_name, application, status, problem_summary |
| `messages` | Chat history | session_id, sender, content, timestamp |
| `knowledge_base` | Static KB articles | title, content, application |
| `mock_logs` | Simulated app logs | application, log_output |
| `settings` | App configuration | key, value (api_provider, api_key, passwords) |
| `documents` | Uploaded PDFs metadata | doc_id, filename, title, chunk_count |

**Service file:** `server/services/googleSheets.js`

---

## AI/LLM Integration

### Multi-Provider Architecture
The app supports multiple LLM providers through a unified interface.

**Service file:** `server/services/llmService.js`

### Supported Providers

| Provider | API Client | Models |
|----------|------------|--------|
| **Anthropic** | `@anthropic-ai/sdk` | claude-sonnet-4-20250514, claude-3-haiku, claude-3-opus |
| **OpenAI** | `openai` | gpt-4o, gpt-4o-mini, gpt-4-turbo |
| **OpenRouter** | `openai` (custom baseURL) | Any model via OpenRouter |
| **Custom** | `openai` (custom baseURL) | Any OpenAI-compatible endpoint |

### How it works:
1. Admin configures provider + API key in Settings
2. API key is encrypted with AES-256-CBC before storage
3. On chat request, `llmService` routes to appropriate provider
4. Retry logic with exponential backoff handles transient failures
5. LLM responds with structured JSON following the system prompt protocol

### Vision Capability
For PDF image processing, the app uses vision-capable models (via OpenRouter) to generate text descriptions of images, making them searchable.

---

## RAG (Retrieval Augmented Generation)

### Document Processing Pipeline

```
PDF Upload
    │
    ├──► pdf-parse ──► Text Extraction ──► Chunking (~500 tokens)
    │
    └──► pdf-to-img + sharp ──► Page Images ──► Vision LLM ──► Image Descriptions
                                                                      │
                                                                      ▼
                                                              Text Chunks
                                                                      │
                                                                      ▼
                                                         Embedding Generation
                                                                      │
                                                                      ▼
                                                         vectors.json (File Store)
```

### PDF Processing Libraries

**pdf-parse**
- Extracts raw text from PDF documents
- Handles multi-page documents

**pdf-to-img**
- Converts PDF pages to images
- Used for visual content that text extraction misses

**sharp**
- High-performance image processing
- Resizes/optimizes extracted images

### Vector Store

**Architecture:** File-based JSON store (not a dedicated vector database)

**File:** `server/data/vectors.json`

**Structure:**
```json
{
  "chunks": [
    {
      "id": "doc123_chunk_0",
      "content": "chunk text...",
      "embedding": [0.123, -0.456, ...],
      "metadata": {
        "type": "text|image",
        "docId": "doc123",
        "chunkIndex": 0
      }
    }
  ],
  "provider": "openai",
  "model": "text-embedding-3-small"
}
```

### Embedding Providers

**Service file:** `server/services/vectorService.js`

| Provider | Models | Dimensions |
|----------|--------|------------|
| **OpenAI** | text-embedding-3-small, text-embedding-3-large | 1536, 3072 |
| **OpenRouter** | openai/text-embedding-3-small | 1536 |
| **Cohere** | embed-english-v3.0, embed-multilingual-v3.0 | 1024 |
| **Jina AI** | jina-embeddings-v2-base-en | 768 |
| **Ollama** (local) | nomic-embed-text, all-minilm | 768, 384 |

### Search Process
1. User query → Generate query embedding
2. Cosine similarity calculation against all stored chunks
3. Return top 5 most similar chunks
4. Inject chunks into LLM context as "Knowledge Base Documents"

---

## Security

### API Key Encryption
**Library:** Node.js `crypto` module

**Algorithm:** AES-256-CBC
- 32-character encryption key (from `ENCRYPTION_KEY` env var)
- Random IV per encryption
- Stored as `iv:encryptedData` in Google Sheets

**File:** `server/middleware/encryption.js`

### Password Hashing
**Algorithm:** SHA-256

Passwords for IT Support and Admin roles are hashed before storage:
```javascript
crypto.createHash('sha256').update('password').digest('hex')
```

### Input Sanitization
**Libraries:** `dompurify`, `jsdom`

All incoming request bodies are sanitized to prevent XSS:
- HTML tags are stripped
- Script content is removed
- Safe output for display

---

## File Upload

### Multer
**Purpose:** Middleware for handling `multipart/form-data` (file uploads)

**Configuration:** `server/middleware/upload.js`
- Stores files in `server/uploads/`
- File naming: `doc-{timestamp}-{random}.pdf`
- File size limits enforced

---

## Development Tooling

### Auto-reload
- **Backend:** `node --watch` (Node 18+ native)
- **Frontend:** Vite HMR

### Environment Configuration
**Library:** `dotenv`

Loads `.env` file into `process.env` for:
- Google Sheets credentials
- Encryption keys
- Default API keys
- Server configuration

---

## Dependencies Summary

### Backend (`server/package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| express | 4.18.x | Web framework |
| @anthropic-ai/sdk | 0.24.x | Anthropic Claude API |
| openai | 4.24.x | OpenAI API (+ OpenRouter) |
| google-spreadsheet | 4.1.x | Google Sheets client |
| google-auth-library | 9.4.x | Google auth |
| chromadb | 1.7.x | Vector DB client (legacy, now file-based) |
| pdf-parse | 1.1.x | PDF text extraction |
| pdf-to-img | 5.0.x | PDF to image conversion |
| sharp | 0.34.x | Image processing |
| multer | 1.4.x | File upload handling |
| dompurify | 3.0.x | XSS sanitization |
| jsdom | 23.0.x | DOM for server-side sanitization |
| express-validator | 7.0.x | Input validation |
| uuid | 9.0.x | Unique ID generation |
| dotenv | 16.3.x | Environment variables |
| cors | 2.8.x | CORS middleware |

### Frontend (`client/package.json`)

| Package | Version | Purpose |
|---------|---------|---------|
| react | 18.2.x | UI library |
| react-dom | 18.2.x | React DOM rendering |
| react-router-dom | 6.21.x | Client routing |
| vite | 5.0.x | Build tool |
| @vitejs/plugin-react | 4.2.x | React plugin for Vite |

---

## Deployment Considerations

### Requirements
- Node.js 18+
- Google Cloud service account with Sheets API enabled
- API keys for at least one LLM provider
- API key for at least one embedding provider (or local Ollama)

### Environment Variables
See `server/.env.example` for full list.

### Production Build
```bash
# Frontend
cd trouble-ticket-app/client
npm run build
# Output in dist/ - serve with static file server

# Backend
cd trouble-ticket-app/server
npm start
```
