/**
 * Chat API routes
 * Handles user chat interactions with the AI assistant
 */
const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { chatMessageRules, sessionIdRules, validateRequest } = require('../middleware/validate');
const googleSheets = require('../services/googleSheets');
const llmService = require('../services/llmService');
const vectorService = require('../services/vectorService');
const { getSystemPrompt } = require('../prompts/systemPrompt');

// Configure image upload storage - persist to disk for session history
const CHAT_IMAGES_DIR = path.join(__dirname, '..', 'data', 'chat-images');
if (!fs.existsSync(CHAT_IMAGES_DIR)) {
  fs.mkdirSync(CHAT_IMAGES_DIR, { recursive: true });
}

// Track uploaded images temporarily until they're associated with a message
const uploadedImages = new Map();

// Helper to get file extension from mimetype
function getExtension(mimetype) {
  const extensions = {
    'image/jpeg': '.jpg',
    'image/png': '.png',
    'image/gif': '.gif',
    'image/webp': '.webp'
  };
  return extensions[mimetype] || '.jpg';
}

// Multer config for image uploads - use disk storage for persistence
const imageStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, CHAT_IMAGES_DIR);
  },
  filename: (req, file, cb) => {
    const imageId = `img_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const ext = getExtension(file.mimetype);
    cb(null, imageId + ext);
  }
});

const imageUpload = multer({
  storage: imageStorage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error('Only JPEG, PNG, GIF, and WebP images are allowed'), false);
    }
  }
});

/**
 * Parse AI JSON response
 * Returns parsed object or null if parsing fails
 */
function parseAIResponse(response) {
  try {
    // Try to parse the entire response as JSON
    return JSON.parse(response);
  } catch (e) {
    // Try to extract JSON from response (in case there's extra text)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch (e2) {
        console.error('Failed to parse AI JSON response:', e2);
      }
    }
  }
  return null;
}

/**
 * Legacy: Extract ticket data from AI response containing [CREATE_TICKET]
 * Kept for backward compatibility
 */
function extractTicketDataLegacy(response) {
  const jsonMatch = response.match(/\[CREATE_TICKET\]\s*(\{[\s\S]*\})/);
  if (jsonMatch) {
    try {
      return JSON.parse(jsonMatch[1]);
    } catch (e) {
      console.error('Failed to parse ticket JSON:', e);
    }
  }
  return null;
}

/**
 * POST /api/chat/upload-image
 * Upload an image for troubleshooting
 * Returns an imageId that can be used with the message endpoint
 * Images are persisted to disk for session history
 */
router.post('/upload-image', imageUpload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image uploaded' });
    }

    // Get imageId from the saved filename (without extension)
    const imageId = path.basename(req.file.filename, path.extname(req.file.filename));

    // Track the uploaded image temporarily until it's used in a message
    uploadedImages.set(imageId, {
      filename: req.file.filename,
      filepath: req.file.path,
      mimetype: req.file.mimetype,
      originalname: req.file.originalname,
      uploadedAt: Date.now()
    });

    // Clean up orphaned images (older than 30 minutes and not used)
    const THIRTY_MINUTES = 30 * 60 * 1000;
    for (const [id, img] of uploadedImages.entries()) {
      if (Date.now() - img.uploadedAt > THIRTY_MINUTES) {
        uploadedImages.delete(id);
        // Note: We don't delete the file since it might have been used
      }
    }

    console.log(`Image uploaded and saved: ${req.file.filename} (${req.file.mimetype}, ${req.file.size} bytes)`);

    res.json({
      imageId: imageId,
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      // Return URL for immediate preview
      imageUrl: `/api/chat/images/${req.file.filename}`
    });
  } catch (error) {
    console.error('Image upload error:', error);
    res.status(500).json({ error: 'Failed to upload image', message: error.message });
  }
});

/**
 * POST /api/chat/message
 * Send a message and get AI response
 * Optionally include imageId to send an image with the message
 */
router.post('/message', chatMessageRules, validateRequest, async (req, res) => {
  try {
    const { sessionId, message, imageId } = req.body;

    // Check if there's an image to process
    let imageData = null;
    let savedImageUrl = null;
    if (imageId && uploadedImages.has(imageId)) {
      const img = uploadedImages.get(imageId);

      // Read image from disk for LLM processing
      const imageBuffer = fs.readFileSync(img.filepath);
      imageData = {
        base64: imageBuffer.toString('base64'),
        mimetype: img.mimetype,
        filename: img.originalname
      };

      // Keep the URL for storing with the message (image persists on disk)
      savedImageUrl = `/api/chat/images/${img.filename}`;

      // Remove from tracking map (file stays on disk)
      uploadedImages.delete(imageId);
      console.log(`Processing message with image: ${img.filename}`);
    }

    // Get conversation history
    const history = await googleSheets.getMessagesBySession(sessionId);

    // Get knowledge base for context (from Google Sheets)
    const knowledgeBase = await googleSheets.getKnowledgeBase();
    const kbContent = knowledgeBase.map(doc =>
      `### ${doc.title} (${doc.application})\n${doc.content}`
    ).join('\n\n---\n\n');

    // Try to detect application from conversation history
    // Look for previous AI responses that identified the application
    let detectedApplication = null;
    for (let i = history.length - 1; i >= 0 && !detectedApplication; i--) {
      const msg = history[i];
      if (msg.sender === 'ai') {
        // Try to parse previous AI response to find application
        const parsed = parseAIResponse(msg.content);
        if (parsed?.application) {
          detectedApplication = parsed.application;
        }
      }
    }

    // Search vector database for relevant document chunks
    // Filter by application if we know which one the user is asking about
    let vectorContext = '';
    let relatedPages = []; // Track pages that can be rendered on-demand
    try {
      const searchOptions = { limit: 5 };
      if (detectedApplication) {
        searchOptions.application = detectedApplication;
        console.log(`Vector search filtered by application: ${detectedApplication}`);
      }

      const vectorResults = await vectorService.search(message, searchOptions);
      if (vectorResults.length > 0) {
        // Track unique pages from search results
        const seenPages = new Set();

        vectorContext = '\n\n## Relevant Documentation\n' +
          vectorResults.map((result, i) => {
            // Track pages for on-demand rendering (avoiding duplicates)
            // Only include if we have a valid page number (> 0)
            const pageNum = result.metadata?.pageNumber || result.metadata?.startPage;
            const docId = result.metadata?.docId;
            const pageKey = `${docId}_${pageNum}`;

            // Check if this is a markdown section (has header but no pageNumber)
            const isMarkdown = result.metadata?.fileType === 'markdown' || result.metadata?.header;
            const header = result.metadata?.header;
            const sectionKey = isMarkdown ? `${docId}_${header}` : pageKey;

            if (isMarkdown && header && docId && !seenPages.has(sectionKey)) {
              // Markdown section - no page viewer, just show section info
              seenPages.add(sectionKey);
              relatedPages.push({
                docId: docId,
                pageNumber: null,
                header: header,
                sectionIndex: result.metadata?.sectionIndex || 0,
                application: result.metadata?.application || '',
                source: result.metadata?.source || '',
                similarity: result.similarity,
                fileType: 'markdown'
              });
            } else if (pageNum && pageNum > 0 && docId && !seenPages.has(pageKey)) {
              // PDF page - include page viewer URL
              seenPages.add(pageKey);
              relatedPages.push({
                docId: docId,
                pageNumber: pageNum,
                startPage: result.metadata?.startPage || pageNum,
                endPage: result.metadata?.endPage || pageNum,
                application: result.metadata?.application || '',
                source: result.metadata?.source || '',
                similarity: result.similarity,
                fileType: 'pdf',
                // URL for on-demand page rendering
                pageUrl: `/api/documents/${docId}/page/${pageNum}`
              });
            }

            // Format context - include page reference if available
            const pageInfo = (pageNum && pageNum > 0) ? ` (Page ${pageNum})` : '';
            return `### [${result.metadata?.application || 'Document'}: ${result.metadata?.source || 'Unknown'}${pageInfo}]\n${result.content}`;
          }).join('\n\n---\n\n');
      }
    } catch (vectorError) {
      // Vector search is optional - continue without it
      console.warn('Vector search failed, continuing without:', vectorError.message);
    }

    // Combine knowledge base with vector search results
    const combinedContext = kbContent + vectorContext;

    // Get custom system prompt if configured
    const customPrompt = await googleSheets.getSetting('system_prompt');

    // Build system prompt with combined context
    const systemPrompt = getSystemPrompt(combinedContext, customPrompt || null);

    // Save user message (with image URL if present)
    await googleSheets.addMessage({
      message_id: uuidv4(),
      session_id: sessionId,
      ticket_id: '',
      sender: 'user',
      content: message,
      timestamp: new Date().toISOString(),
      read: 'TRUE',
      image_url: savedImageUrl || ''
    });

    // Get AI response (with or without image)
    let rawAiResponse;
    try {
      if (imageData) {
        // Use vision-capable LLM for image analysis
        rawAiResponse = await llmService.sendMessageWithImage(
          message,
          imageData.base64,
          imageData.mimetype,
          history,
          systemPrompt
        );
      } else {
        rawAiResponse = await llmService.sendMessage(message, history, knowledgeBase, systemPrompt);
      }
    } catch (error) {
      console.error('LLM error:', error);
      rawAiResponse = JSON.stringify({
        response: `I'm sorry, I'm having trouble connecting to the AI service right now. Please try again in a moment. Error: ${error.message}`,
        application: null,
        status: 'collecting',
        ticket_data: null
      });
    }

    // Parse the AI JSON response
    let parsedResponse = parseAIResponse(rawAiResponse);
    let displayResponse;
    let ticketCreated = null;
    let conversationStatus = 'collecting';

    if (parsedResponse && parsedResponse.response) {
      // Successfully parsed JSON response
      displayResponse = parsedResponse.response;
      conversationStatus = parsedResponse.status || 'collecting';

      // Check if AI wants to escalate (create ticket)
      if (parsedResponse.status === 'escalate' && parsedResponse.ticket_data) {
        const ticketData = parsedResponse.ticket_data;

        // Validate required fields before creating ticket
        const hasApplication = parsedResponse.application && parsedResponse.application !== 'null';
        const hasProblemSummary = ticketData.problem_summary && ticketData.problem_summary.trim().length > 0;
        const hasProblemDetails = ticketData.problem_details && ticketData.problem_details.trim().length > 0;

        if (hasApplication && hasProblemSummary && hasProblemDetails) {
          // Try to find a matching mock log
          const mockLog = await googleSheets.findMatchingMockLog(
            parsedResponse.application,
            ticketData.error_pattern || ''
          );

          // Create the ticket
          ticketCreated = await googleSheets.createTicket({
            ticket_id: `TKT-${Date.now().toString().slice(-5)}`,
            session_id: sessionId,
            status: 'open',
            application: parsedResponse.application || 'Unknown',
            problem_summary: ticketData.problem_summary || 'Issue reported by user',
            problem_details: ticketData.problem_details || message,
            reported_by: ticketData.user_name || '',
            reported_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            assigned_log: mockLog?.log_id || '',
            suggested_fix: mockLog?.suggested_fix || 'Requires manual analysis',
            it_notes: '',
            resolved_at: ''
          });

          // Append ticket confirmation to response
          displayResponse += `\n\nI've created ticket **${ticketCreated.ticket_id}** for you. Our IT team will look into this and may reach out if they need more information.`;
        } else {
          // Missing required info - don't create ticket, add note to response
          console.warn('Ticket creation blocked - missing required fields:', {
            hasApplication, hasProblemSummary, hasProblemDetails
          });
          // Let the AI response stand without ticket creation
        }
      }
    } else {
      // Fallback: Check for legacy [CREATE_TICKET] format
      if (rawAiResponse.includes('[CREATE_TICKET]')) {
        const ticketData = extractTicketDataLegacy(rawAiResponse);

        if (ticketData) {
          const mockLog = await googleSheets.findMatchingMockLog(
            ticketData.application,
            ticketData.error_pattern || ''
          );

          ticketCreated = await googleSheets.createTicket({
            ticket_id: `TKT-${Date.now().toString().slice(-5)}`,
            session_id: sessionId,
            status: 'open',
            application: ticketData.application || 'Unknown',
            problem_summary: ticketData.problem_summary || 'Issue reported by user',
            problem_details: ticketData.problem_details || message,
            reported_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            assigned_log: mockLog?.log_id || '',
            suggested_fix: mockLog?.suggested_fix || 'Requires manual analysis',
            it_notes: '',
            resolved_at: ''
          });

          displayResponse = rawAiResponse.replace(/\[CREATE_TICKET\][\s\S]*$/, '').trim();
          displayResponse += `\n\nI've created ticket **${ticketCreated.ticket_id}** for you. Our IT team will look into this and may reach out if they need more information.`;
        } else {
          displayResponse = rawAiResponse;
        }
      } else {
        // Plain text response (non-JSON, non-legacy format)
        displayResponse = rawAiResponse;
      }
    }

    // If status is "resolved", close any open tickets for this session
    let ticketsClosed = [];
    if (conversationStatus === 'resolved') {
      try {
        const openTickets = await googleSheets.getOpenTicketsBySession(sessionId);
        for (const ticket of openTickets) {
          await googleSheets.updateTicket(ticket.ticket_id, {
            status: 'closed',
            resolved_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            it_notes: (ticket.it_notes || '') + '\n[Auto-closed: User confirmed issue resolved]'
          });
          ticketsClosed.push(ticket.ticket_id);
          console.log(`Auto-closed ticket ${ticket.ticket_id} - user confirmed resolved`);
        }

        // Append closure info to response if tickets were closed
        if (ticketsClosed.length > 0) {
          displayResponse += `\n\n_(Your support ticket${ticketsClosed.length > 1 ? 's have' : ' has'} been closed.)_`;
        }
      } catch (closeError) {
        console.error('Error auto-closing tickets:', closeError);
      }
    }

    // Only show pages when the AI explicitly requests it via show_documentation flag
    // This prevents unwanted documentation display (e.g., when user uploads their own screenshot)
    const shouldShowPages = parsedResponse?.show_documentation === true && relatedPages.length > 0;

    // Save AI response (human-readable version)
    // Include related_pages only if we're showing them to the user
    const pagesToStore = shouldShowPages ? relatedPages : null;
    await googleSheets.addMessage({
      message_id: uuidv4(),
      session_id: sessionId,
      ticket_id: ticketCreated?.ticket_id || '',
      sender: 'ai',
      content: displayResponse,
      timestamp: new Date().toISOString(),
      read: 'TRUE',
      related_pages: pagesToStore ? JSON.stringify(pagesToStore) : ''
    });

    res.json({
      response: displayResponse,
      ticket: ticketCreated,
      ticketsClosed: ticketsClosed,
      status: conversationStatus,
      application: parsedResponse?.application || null,
      relatedPages: shouldShowPages ? relatedPages : null,
      savedImageUrl: savedImageUrl || null
    });
  } catch (error) {
    console.error('Chat error:', error);
    res.status(500).json({ error: 'Failed to process message', details: error.message });
  }
});

/**
 * GET /api/chat/session/:sessionId
 * Get all messages for a session
 */
router.get('/session/:sessionId', sessionIdRules, validateRequest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await googleSheets.getMessagesBySession(sessionId);
    res.json(messages);
  } catch (error) {
    console.error('Get session error:', error);
    res.status(500).json({ error: 'Failed to fetch session' });
  }
});

/**
 * GET /api/chat/notifications/:sessionId
 * Check for unread messages (for notification bell)
 */
router.get('/notifications/:sessionId', sessionIdRules, validateRequest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const unreadMessages = await googleSheets.getUnreadMessages(sessionId);
    res.json({
      hasNotifications: unreadMessages.length > 0,
      count: unreadMessages.length
    });
  } catch (error) {
    console.error('Notifications error:', error);
    res.status(500).json({ error: 'Failed to check notifications' });
  }
});

/**
 * POST /api/chat/mark-read
 * Mark messages as read
 */
router.post('/mark-read', async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).json({ error: 'sessionId is required' });
    }

    const count = await googleSheets.markMessagesAsRead(sessionId);
    res.json({ success: true, markedCount: count });
  } catch (error) {
    console.error('Mark read error:', error);
    res.status(500).json({ error: 'Failed to mark as read' });
  }
});

/**
 * GET /api/chat/images/:filename
 * Serve saved chat images
 */
router.get('/images/:filename', (req, res) => {
  try {
    const { filename } = req.params;

    // Sanitize filename to prevent directory traversal
    const sanitizedFilename = path.basename(filename);
    const imagePath = path.join(CHAT_IMAGES_DIR, sanitizedFilename);

    // Check if file exists
    if (!fs.existsSync(imagePath)) {
      return res.status(404).json({ error: 'Image not found' });
    }

    // Determine content type from extension
    const ext = path.extname(sanitizedFilename).toLowerCase();
    const contentTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp'
    };
    const contentType = contentTypes[ext] || 'image/jpeg';

    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'public, max-age=31536000'); // Cache for 1 year
    res.sendFile(imagePath);
  } catch (error) {
    console.error('Error serving chat image:', error);
    res.status(500).json({ error: 'Failed to serve image' });
  }
});

/**
 * GET /api/chat/export/:sessionId
 * Export chat transcript as text file
 */
router.get('/export/:sessionId', sessionIdRules, validateRequest, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const messages = await googleSheets.getMessagesBySession(sessionId);

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
