/**
 * Document Management API routes
 * Handles document upload, processing, and vector storage
 */
const express = require('express');
const router = express.Router();
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { upload, handleUploadError } = require('../middleware/upload');
const { requireRole } = require('../middleware/auth');
const documentService = require('../services/documentService');
const vectorService = require('../services/vectorService');
const googleSheets = require('../services/googleSheets');

/**
 * POST /api/documents/upload
 * Upload and process a PDF document
 * Requires admin role
 */
router.post('/upload',
  requireRole('admin'),
  upload.single('file'),
  handleUploadError,
  async (req, res) => {
    const filePath = req.file?.path;

    try {
      if (!req.file) {
        return res.status(400).json({ error: 'No file uploaded' });
      }

      const { title, application } = req.body;

      if (!application) {
        return res.status(400).json({ error: 'Application name is required' });
      }

      const docId = `doc_${uuidv4().slice(0, 8)}`;

      // Process the PDF
      console.log(`Processing document: ${req.file.originalname} for application: ${application}`);
      const result = await documentService.processDocument(filePath, docId, { application });

      // Add application to each chunk before storing
      const chunksWithApp = result.chunks.map(chunk => ({
        ...chunk,
        application: application
      }));

      // Store chunks in vector database
      console.log(`Storing ${chunksWithApp.length} chunks in vector database`);
      await vectorService.addChunks(chunksWithApp);

      // Save document metadata to Google Sheets
      await googleSheets.addDocument({
        doc_id: docId,
        filename: req.file.originalname,
        title: title || req.file.originalname.replace('.pdf', ''),
        application: application,
        upload_date: new Date().toISOString(),
        status: 'processed',
        chunk_count: result.chunks.length,
        file_size: req.file.size,
        num_pages: result.metadata.numPages
      });

      // Clean up uploaded file
      documentService.deleteFile(filePath);

      res.json({
        success: true,
        document: {
          docId: docId,
          filename: req.file.originalname,
          title: title || req.file.originalname,
          application: application,
          numPages: result.metadata.numPages,
          chunkCount: result.chunks.length,
          totalTokens: result.metadata.totalTokens
        }
      });
    } catch (error) {
      console.error('Document upload error:', error);

      // Clean up file on error
      if (filePath) {
        documentService.deleteFile(filePath);
      }

      res.status(500).json({
        error: 'Failed to process document',
        message: error.message
      });
    }
  }
);

/**
 * GET /api/documents
 * List all uploaded documents
 * Requires admin role
 */
router.get('/', requireRole('admin'), async (req, res) => {
  try {
    const documents = await googleSheets.getAllDocuments();
    res.json(documents);
  } catch (error) {
    console.error('List documents error:', error);
    res.status(500).json({ error: 'Failed to list documents' });
  }
});

/**
 * GET /api/documents/:docId
 * Get document details
 * Requires admin role
 */
router.get('/:docId', requireRole('admin'), async (req, res) => {
  try {
    const { docId } = req.params;
    const document = await googleSheets.getDocument(docId);

    if (!document) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(document);
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Failed to get document' });
  }
});

/**
 * DELETE /api/documents/:docId
 * Delete a document and its vectors
 * Requires admin role
 */
router.delete('/:docId', requireRole('admin'), async (req, res) => {
  try {
    const { docId } = req.params;

    // Delete from vector database
    await vectorService.deleteDocument(docId);

    // Delete from Google Sheets
    const deleted = await googleSheets.deleteDocument(docId);

    if (!deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * POST /api/documents/search
 * Semantic search across documents
 * Optionally filter by application
 */
router.post('/search', async (req, res) => {
  try {
    const { query, limit = 5, application } = req.body;

    if (!query) {
      return res.status(400).json({ error: 'Query is required' });
    }

    const searchOptions = { limit };
    if (application) {
      searchOptions.application = application;
    }

    const results = await vectorService.search(query, searchOptions);

    res.json({
      query: query,
      application: application || 'all',
      results: results
    });
  } catch (error) {
    console.error('Search error:', error);
    res.status(500).json({ error: 'Search failed', message: error.message });
  }
});

/**
 * GET /api/documents/stats
 * Get vector database statistics
 * Requires admin role
 */
router.get('/stats/summary', requireRole('admin'), async (req, res) => {
  try {
    const stats = await vectorService.getStats();
    const documents = await googleSheets.getAllDocuments();

    res.json({
      ...stats,
      documentCount: documents.length
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

module.exports = router;
