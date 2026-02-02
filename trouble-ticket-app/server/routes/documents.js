/**
 * Document Management API routes
 * Handles document upload, processing, vector storage, and image extraction
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
 * Upload and process a PDF or Markdown document
 * PDF: Text is extracted with page numbers for on-demand page rendering
 * Markdown: Text is chunked by headers for FAQ-style content
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
      const ext = path.extname(req.file.originalname).toLowerCase();
      const isMarkdown = ext === '.md';

      // Process the document (PDF or Markdown)
      console.log(`Processing ${isMarkdown ? 'markdown' : 'PDF'} document: ${req.file.originalname} for application: ${application}`);
      const result = await documentService.processDocument(filePath, docId, { application });

      // Add application to each chunk before storing
      const chunksWithApp = result.chunks.map(chunk => ({
        ...chunk,
        application: application
      }));

      // Store text chunks in vector database
      console.log(`Storing ${chunksWithApp.length} ${isMarkdown ? 'section' : 'text'} chunks in vector database`);
      await vectorService.addChunks(chunksWithApp, 'text');

      // For PDFs, keep the file for on-demand page rendering
      // For Markdown, we don't need to keep the file
      if (!isMarkdown) {
        documentService.keepPDFFile(filePath, docId);
        console.log(`Stored PDF for on-demand rendering: ${docId}`);
      }

      // Save document metadata to Google Sheets
      const fileExtClean = ext.replace('.', '');
      await googleSheets.addDocument({
        doc_id: docId,
        filename: req.file.originalname,
        title: title || req.file.originalname.replace(ext, ''),
        application: application,
        upload_date: new Date().toISOString(),
        status: 'processed',
        chunk_count: result.chunks.length,
        image_count: 0,
        file_size: req.file.size,
        num_pages: result.metadata.numPages,
        file_type: isMarkdown ? 'markdown' : 'pdf'
      });

      // Clean up the temp uploaded file
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
          totalTokens: result.metadata.totalTokens,
          fileType: isMarkdown ? 'markdown' : 'pdf'
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
 * GET /api/documents/applications
 * Get unique application names from all documents
 * Public endpoint for populating dropdown
 */
router.get('/applications', async (req, res) => {
  try {
    const documents = await googleSheets.getAllDocuments();
    const applications = [...new Set(documents.map(d => d.application))].filter(Boolean);
    res.json(applications);
  } catch (error) {
    console.error('Get applications error:', error);
    res.status(500).json({ error: 'Failed to get applications' });
  }
});

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
 * Delete a document, its vectors, stored PDF, and any legacy images
 * Requires admin role
 */
router.delete('/:docId', requireRole('admin'), async (req, res) => {
  try {
    const { docId } = req.params;

    // Delete from vector database
    await vectorService.deleteDocument(docId);

    // Delete stored PDF
    documentService.deleteStoredPDF(docId);

    // Delete any legacy extracted images
    documentService.deleteDocumentImages(docId);

    // Delete from Google Sheets
    const deleted = await googleSheets.deleteDocument(docId);

    if (!deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ success: true, message: 'Document deleted successfully' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

/**
 * GET /api/documents/:docId/page/:pageNum
 * Render a specific PDF page as an image (on-demand)
 * Public endpoint for displaying pages in chat
 */
router.get('/:docId/page/:pageNum', async (req, res) => {
  try {
    const { docId, pageNum } = req.params;
    const pageNumber = parseInt(pageNum, 10);

    if (isNaN(pageNumber) || pageNumber < 1) {
      return res.status(400).json({ error: 'Invalid page number' });
    }

    // Validate docId format
    if (!docId.match(/^doc_[a-z0-9-]+$/)) {
      return res.status(400).json({ error: 'Invalid document ID format' });
    }

    console.log(`Rendering page ${pageNumber} for document ${docId}`);
    const imageBuffer = await documentService.renderPDFPage(docId, pageNumber);

    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'public, max-age=3600'); // Cache for 1 hour
    res.send(imageBuffer);
  } catch (error) {
    console.error('Page render error:', error);
    if (error.message.includes('not found')) {
      return res.status(404).json({ error: error.message });
    }
    if (error.message.includes('out of range')) {
      return res.status(400).json({ error: error.message });
    }
    res.status(500).json({ error: 'Failed to render page' });
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

    // Count total pages across all documents
    const totalPages = documents.reduce((sum, doc) => sum + (parseInt(doc.num_pages) || 0), 0);

    res.json({
      ...stats,
      documentCount: documents.length,
      totalPages: totalPages
    });
  } catch (error) {
    console.error('Stats error:', error);
    res.status(500).json({ error: 'Failed to get statistics' });
  }
});

/**
 * GET /api/documents/images/:filename
 * Serve an extracted image file
 * Public endpoint for displaying images in chat
 */
router.get('/images/:filename', (req, res) => {
  try {
    const { filename } = req.params;

    // Security: validate filename format to prevent path traversal
    if (!filename.match(/^doc_[a-z0-9-]+_p\d+_i\d+\.png$/)) {
      return res.status(400).json({ error: 'Invalid filename format' });
    }

    const imagesDir = documentService.getImagesDirectory();
    const imagePath = path.join(imagesDir, filename);

    // Check if file exists
    const fs = require('fs');
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Serve the image
    res.sendFile(imagePath);
  } catch (error) {
    console.error('Image serve error:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

/**
 * GET /api/documents/:docId/images
 * Get all images for a document
 * Requires admin role
 */
router.get('/:docId/images', requireRole('admin'), async (req, res) => {
  try {
    const { docId } = req.params;

    const images = documentService.getDocumentImages(docId);
    const imageUrls = images.map(img => ({
      filename: img.filename,
      url: `/api/documents/images/${img.filename}`
    }));

    res.json(imageUrls);
  } catch (error) {
    console.error('Get document images error:', error);
    res.status(500).json({ error: 'Failed to get document images' });
  }
});

module.exports = router;
