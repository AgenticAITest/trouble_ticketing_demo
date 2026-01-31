# Vector Database Implementation Plan

## Overview

This document outlines the implementation plan for adding vector database capabilities to the Trouble Ticketing AI Assistant. The goal is to enable semantic search over uploaded documents (like user manuals) using embeddings.

## Current State

- Knowledge base stored in Google Sheets as plain text
- Entire knowledge base passed to LLM on each query
- No document upload capability
- No semantic search

## Target Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   PDF Upload    │────▶│  Text Extract   │────▶│   Chunking      │
│   (Multer)      │     │  (pdf-parse)    │     │   Service       │
└─────────────────┘     └─────────────────┘     └────────┬────────┘
                                                         │
                                                         ▼
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   Chat Query    │────▶│  Embedding      │────▶│   ChromaDB      │
│                 │     │  (OpenAI)       │     │   Vector Store  │
└─────────────────┘     └────────┬────────┘     └─────────────────┘
                                 │
                                 ▼
                        ┌─────────────────┐
                        │  LLM Response   │
                        │  with Context   │
                        └─────────────────┘
```

## Implementation Phases

### Phase 1: Text-Only RAG (Current Focus)

**Goal**: Basic document upload with text extraction and vector search

**New Files**:
```
server/
├── services/
│   ├── vectorService.js      # Embeddings & ChromaDB operations
│   └── documentService.js    # PDF processing & text chunking
├── routes/
│   └── documents.js          # Document upload/management API
├── middleware/
│   └── upload.js             # Multer configuration
└── uploads/                  # Temporary file storage
```

**Dependencies**:
- `pdf-parse` - PDF text extraction
- `chromadb` - Vector database (local, no external service needed)
- `multer` - File upload handling
- `openai` - Already installed, used for embeddings

**Components**:

1. **Document Upload API** (`routes/documents.js`)
   - POST `/api/documents/upload` - Upload PDF
   - GET `/api/documents` - List uploaded documents
   - DELETE `/api/documents/:id` - Remove document

2. **Document Service** (`services/documentService.js`)
   - Extract text from PDF using pdf-parse
   - Clean and normalize extracted text
   - Chunk text into ~500-token segments with 50-token overlap
   - Store document metadata in Google Sheets

3. **Vector Service** (`services/vectorService.js`)
   - Initialize ChromaDB collection
   - Generate embeddings via OpenAI text-embedding-3-small
   - Store/retrieve vectors
   - Semantic search function

4. **Chat Integration** (modify `routes/chat.js`)
   - Before LLM call, search vector DB for relevant chunks
   - Inject top-k results into context
   - Reduce/replace full KB injection

**Chunking Strategy**:
```
Document → Paragraphs → Chunks (500 tokens, 50 overlap)
                              ↓
                        Metadata: {
                          doc_id,
                          chunk_index,
                          page_number,
                          source_file
                        }
```

### Phase 2: Enhanced Processing (Future)

**Goal**: Better handling of graphics-heavy documents

**Features**:
- Multimodal processing using vision models
- Screenshot description generation
- OCR for text in images
- Structured data extraction from tables

### Phase 3: Advanced Features (Future)

**Goal**: Production-ready features

**Features**:
- Document versioning
- Incremental updates
- Hybrid search (keyword + semantic)
- User feedback loop for relevance tuning

## Database Schema Changes

### New Google Sheet: `documents`
```
doc_id | filename | title | upload_date | status | chunk_count | file_size | uploaded_by
```

### New Google Sheet: `document_chunks`
```
chunk_id | doc_id | chunk_index | page_number | content_preview | embedding_id
```

## API Endpoints

### Document Management

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/documents/upload` | Upload PDF file |
| GET | `/api/documents` | List all documents |
| GET | `/api/documents/:id` | Get document details |
| DELETE | `/api/documents/:id` | Delete document and vectors |
| POST | `/api/documents/:id/reprocess` | Re-extract and re-embed |

### Search

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/search/semantic` | Semantic search across all docs |
| POST | `/api/search/hybrid` | Combined keyword + semantic |

## Configuration

### Environment Variables
```env
# Embedding Configuration
EMBEDDING_MODEL=text-embedding-3-small
EMBEDDING_DIMENSIONS=1536

# ChromaDB Configuration
CHROMA_PERSIST_PATH=./chroma_data
CHROMA_COLLECTION_NAME=knowledge_base

# Chunking Configuration
CHUNK_SIZE=500
CHUNK_OVERLAP=50
```

## Error Handling

- PDF parsing failures → Return error with details, don't store partial
- Embedding API failures → Retry with backoff, queue for later
- Vector DB unavailable → Fallback to keyword search on Google Sheets

## Performance Considerations

- Batch embedding requests (max 2048 inputs per call)
- Lazy-load ChromaDB connection
- Cache frequently accessed chunks
- Limit context window injection to top-5 results

## Security

- Validate file types (PDF only initially)
- Limit file size (10MB max)
- Sanitize filenames
- Admin-only upload access

## Testing Strategy

1. Unit tests for chunking logic
2. Integration tests for upload flow
3. End-to-end tests for RAG pipeline
4. Performance benchmarks with sample documents

## Rollback Plan

- Feature flag to disable vector search
- Fallback to existing Google Sheets KB
- Data export capability for vector store

---

## Phase 1 Implementation Checklist

- [x] Add dependencies to package.json (pdf-parse, chromadb, multer)
- [x] Create upload middleware (multer config)
- [x] Create documentService.js
- [x] Create vectorService.js
- [x] Create documents.js routes
- [x] Add documents operations to googleSheets.js
- [x] Modify chat.js for RAG integration
- [x] Update CLAUDE.md with new architecture
- [x] Add application field support for document filtering
- [x] Create admin UI for document upload (DocumentManager component)
- [x] Add documentsApi to frontend api.js
- [ ] Add documents sheet to Google Sheets (manual step)
- [ ] Install new npm dependencies (`npm install` in server/)
- [ ] Test with sample PDF
