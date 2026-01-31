# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI-powered IT support chatbot that helps employees troubleshoot issues with company applications (Attendance, Delivery, Inventory apps), automatically creates support tickets when AI troubleshooting fails, and provides an IT support dashboard for ticket management.

## Development Commands

All commands are run from within `trouble-ticket-app/`:

```bash
# Backend (from trouble-ticket-app/server/)
npm run dev          # Start with auto-reload (uses node --watch)
npm start            # Production mode

# Frontend (from trouble-ticket-app/client/)
npm run dev          # Vite dev server on port 5173
npm run build        # Production build
npm run preview      # Preview production build
```

The frontend proxies `/api` requests to `http://localhost:3001`.

## Architecture

### Three-Tier Structure
```
React Frontend (5173) → Express Backend (3001) → Google Sheets (database)
                              ↓
                     LLM Providers (Anthropic/OpenAI/OpenRouter)
```

### Role-Based Access
- **User**: Chat interface only (public)
- **IT Support**: Ticket dashboard (password protected)
- **Admin**: Settings & knowledge base management (password protected)

Authentication uses SHA-256 hashed passwords stored in Google Sheets settings.

### AI Chat Protocol (Three Phases)
1. **Data Collection**: Gather application name, user identity, error details, reproduction steps
2. **Troubleshooting**: Query knowledge base, provide step-by-step solutions
3. **Resolution**: Mark resolved OR escalate to ticket (with user confirmation)

The LLM must respond with strict JSON: `{ response, application, status, ticket_data }`

### Key Backend Components
- `server/services/llmService.js` - Multi-provider LLM integration with retry logic
- `server/services/googleSheets.js` - All database CRUD operations
- `server/services/vectorService.js` - ChromaDB vector database for semantic search
- `server/services/documentService.js` - PDF text extraction and chunking
- `server/prompts/systemPrompt.js` - AI behavior and response format definitions
- `server/middleware/auth.js` - Role-based access control (`requireRole`, `optionalAuth`)
- `server/middleware/upload.js` - Multer configuration for PDF uploads

### Key Frontend Components
- `client/src/context/AuthContext.jsx` - Authentication state
- `client/src/context/SessionContext.jsx` - Chat session management
- `client/src/pages/` - UserChat, ITSupport, AdminSettings, Login pages

## Database Schema (Google Sheets)

Six sheets: `tickets`, `messages`, `knowledge_base`, `mock_logs`, `settings`, `documents`

- Settings sheet stores: `api_provider`, `api_key`, `api_model`, `it_support_password_hash`, `admin_password_hash`
- Documents sheet stores: `doc_id`, `filename`, `title`, `upload_date`, `status`, `chunk_count`, `file_size`, `num_pages`

## RAG (Retrieval Augmented Generation) Architecture

```
PDF Upload → Text Extraction → Chunking → Embeddings → ChromaDB
                                                          ↓
User Query → Query Embedding → Vector Search → Top-K Results → LLM Context
```

### Components
- **Document Upload**: Admin uploads PDF via `/api/documents/upload`
- **Text Extraction**: `pdf-parse` extracts text from PDF
- **Chunking**: ~500 token chunks with 50 token overlap for context preservation
- **Embeddings**: OpenAI `text-embedding-3-small` model
- **Vector DB**: ChromaDB (local, no external service required)
- **Search**: Semantic similarity search returns top 5 relevant chunks

### API Endpoints
- `POST /api/documents/upload` - Upload PDF (admin only)
- `GET /api/documents` - List documents (admin only)
- `DELETE /api/documents/:docId` - Delete document (admin only)
- `POST /api/documents/search` - Semantic search (public)

## Environment Setup

Copy `server/.env.example` to `server/.env` and configure:
- Google Sheets credentials (service account email + private key)
- `ENCRYPTION_KEY` - exactly 32 characters for API key encryption
- `GOOGLE_SPREADSHEET_ID` - the spreadsheet ID from the URL

Generate encryption key:
```bash
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

Generate password hashes:
```bash
node -e "console.log(require('crypto').createHash('sha256').update('your-password').digest('hex'))"
```
