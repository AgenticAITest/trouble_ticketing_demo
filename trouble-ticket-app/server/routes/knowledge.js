/**
 * Knowledge Base API routes
 * Handles CRUD operations for knowledge base documents
 */
const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { knowledgeDocRules, validateRequest } = require('../middleware/validate');
const googleSheets = require('../services/googleSheets');

/**
 * GET /api/knowledge
 * Get all knowledge base documents (public for AI context)
 */
router.get('/', async (req, res) => {
  try {
    const documents = await googleSheets.getKnowledgeBase();
    res.json(documents);
  } catch (error) {
    console.error('Get knowledge base error:', error);
    res.status(500).json({ error: 'Failed to fetch knowledge base' });
  }
});

/**
 * GET /api/knowledge/:id
 * Get a single knowledge base document
 */
router.get('/:id', async (req, res) => {
  try {
    const doc = await googleSheets.getKnowledgeDoc(req.params.id);
    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }
    res.json(doc);
  } catch (error) {
    console.error('Get document error:', error);
    res.status(500).json({ error: 'Failed to fetch document' });
  }
});

// Admin-only routes below
router.use(requireRole('admin'));

/**
 * POST /api/knowledge
 * Add a new knowledge base document
 */
router.post('/', knowledgeDocRules, validateRequest, async (req, res) => {
  try {
    const { application, title, content, keywords } = req.body;

    const doc = await googleSheets.addKnowledgeDoc({
      application,
      title,
      content,
      keywords
    });

    res.status(201).json(doc);
  } catch (error) {
    console.error('Add document error:', error);
    res.status(500).json({ error: 'Failed to add document' });
  }
});

/**
 * PUT /api/knowledge/:id
 * Update a knowledge base document
 */
router.put('/:id', knowledgeDocRules, validateRequest, async (req, res) => {
  try {
    const { application, title, content, keywords } = req.body;

    const doc = await googleSheets.updateKnowledgeDoc(req.params.id, {
      application,
      title,
      content,
      keywords
    });

    if (!doc) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json(doc);
  } catch (error) {
    console.error('Update document error:', error);
    res.status(500).json({ error: 'Failed to update document' });
  }
});

/**
 * DELETE /api/knowledge/:id
 * Delete a knowledge base document
 */
router.delete('/:id', async (req, res) => {
  try {
    const deleted = await googleSheets.deleteKnowledgeDoc(req.params.id);

    if (!deleted) {
      return res.status(404).json({ error: 'Document not found' });
    }

    res.json({ success: true, message: 'Document deleted' });
  } catch (error) {
    console.error('Delete document error:', error);
    res.status(500).json({ error: 'Failed to delete document' });
  }
});

module.exports = router;
