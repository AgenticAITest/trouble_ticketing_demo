/**
 * Google Sheets integration service
 * Handles all database operations using Google Sheets as the backend
 */
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

// Configuration
const SPREADSHEET_ID = process.env.GOOGLE_SPREADSHEET_ID;

// Initialize auth
let serviceAccountAuth = null;
let doc = null;
let initialized = false;

/**
 * Initialize Google Sheets connection
 */
async function initSheet() {
  if (initialized && doc) {
    return doc;
  }

  if (!SPREADSHEET_ID) {
    throw new Error('GOOGLE_SPREADSHEET_ID environment variable is required');
  }

  if (!process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || !process.env.GOOGLE_PRIVATE_KEY) {
    throw new Error('Google service account credentials are required');
  }

  serviceAccountAuth = new JWT({
    email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
    key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
    scopes: ['https://www.googleapis.com/auth/spreadsheets'],
  });

  doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
  await doc.loadInfo();
  initialized = true;

  console.log(`Connected to Google Sheet: ${doc.title}`);
  return doc;
}

/**
 * Get a specific sheet by name
 * @param {string} sheetName - Name of the sheet (tab)
 */
async function getSheet(sheetName) {
  await initSheet();
  const sheet = doc.sheetsByTitle[sheetName];
  if (!sheet) {
    throw new Error(`Sheet "${sheetName}" not found. Available sheets: ${Object.keys(doc.sheetsByTitle).join(', ')}`);
  }
  return sheet;
}

// ============================================
// TICKET OPERATIONS
// ============================================

/**
 * Create a new ticket
 */
async function createTicket(ticketData) {
  const sheet = await getSheet('tickets');
  const row = await sheet.addRow({
    ticket_id: ticketData.ticket_id,
    session_id: ticketData.session_id,
    status: ticketData.status || 'open',
    application: ticketData.application,
    problem_summary: ticketData.problem_summary,
    problem_details: ticketData.problem_details,
    reported_by: ticketData.reported_by || '',
    reported_at: ticketData.reported_at || new Date().toISOString(),
    updated_at: ticketData.updated_at || new Date().toISOString(),
    assigned_log: ticketData.assigned_log || '',
    suggested_fix: ticketData.suggested_fix || '',
    it_notes: ticketData.it_notes || '',
    resolved_at: ticketData.resolved_at || ''
  });
  return rowToObject(row);
}

/**
 * Get all tickets
 */
async function getAllTickets() {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  return rows.map(rowToObject);
}

/**
 * Get tickets filtered by status
 */
async function getTicketsByStatus(status) {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  return rows
    .filter(row => row.get('status') === status)
    .map(rowToObject);
}

/**
 * Get a single ticket by ID
 */
async function getTicketById(ticketId) {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ticket_id') === ticketId);
  return row ? rowToObject(row) : null;
}

/**
 * Get open tickets for a session
 */
async function getOpenTicketsBySession(sessionId) {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  return rows
    .filter(row =>
      row.get('session_id') === sessionId &&
      ['open', 'waiting_clarification', 'waiting_confirmation'].includes(row.get('status'))
    )
    .map(rowToObject);
}

/**
 * Update a ticket
 */
async function updateTicket(ticketId, updates) {
  const sheet = await getSheet('tickets');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('ticket_id') === ticketId);

  if (!row) {
    return null;
  }

  Object.entries(updates).forEach(([key, value]) => {
    row.set(key, value);
  });

  await row.save();
  return rowToObject(row);
}

// ============================================
// MESSAGE OPERATIONS
// ============================================

/**
 * Add a new message
 */
async function addMessage(messageData) {
  const sheet = await getSheet('message');
  const row = await sheet.addRow({
    message_id: messageData.message_id,
    session_id: messageData.session_id,
    ticket_id: messageData.ticket_id || '',
    sender: messageData.sender,
    content: messageData.content,
    timestamp: messageData.timestamp || new Date().toISOString(),
    read: messageData.read || 'FALSE',
    related_pages: messageData.related_pages || ''
  });
  return rowToObject(row);
}

/**
 * Get all messages for a session
 */
async function getMessagesBySession(sessionId) {
  const sheet = await getSheet('message');
  const rows = await sheet.getRows();
  return rows
    .filter(row => row.get('session_id') === sessionId)
    .map(row => {
      const message = rowToObject(row);
      // Parse related_pages JSON if present
      if (message.related_pages) {
        try {
          message.relatedPages = JSON.parse(message.related_pages);
        } catch (e) {
          message.relatedPages = null;
        }
      } else {
        message.relatedPages = null;
      }
      return message;
    })
    .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
}

/**
 * Get unread messages from IT support for a session
 */
async function getUnreadMessages(sessionId) {
  const sheet = await getSheet('message');
  const rows = await sheet.getRows();
  return rows
    .filter(row =>
      row.get('session_id') === sessionId &&
      row.get('read') === 'FALSE' &&
      row.get('sender') === 'it_support'
    )
    .map(rowToObject);
}

/**
 * Mark messages as read for a session
 */
async function markMessagesAsRead(sessionId) {
  const sheet = await getSheet('message');
  const rows = await sheet.getRows();
  const unreadRows = rows.filter(row =>
    row.get('session_id') === sessionId &&
    row.get('read') === 'FALSE' &&
    row.get('sender') === 'it_support'
  );

  for (const row of unreadRows) {
    row.set('read', 'TRUE');
    await row.save();
  }

  return unreadRows.length;
}

// ============================================
// MOCK LOGS OPERATIONS
// ============================================

/**
 * Get a mock log by ID
 */
async function getMockLog(logId) {
  const sheet = await getSheet('mock_logs');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('log_id') === logId);
  return row ? rowToObject(row) : null;
}

/**
 * Get all mock logs
 */
async function getAllMockLogs() {
  const sheet = await getSheet('mock_logs');
  const rows = await sheet.getRows();
  return rows.map(rowToObject);
}

/**
 * Find a mock log matching an application and error pattern
 * Returns null if no confident match is found
 */
async function findMatchingMockLog(application, errorPattern) {
  const sheet = await getSheet('mock_logs');
  const rows = await sheet.getRows();

  // Common words to ignore in matching
  const stopWords = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'been', 'be',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
    'could', 'should', 'may', 'might', 'must', 'shall', 'can',
    'need', 'dare', 'ought', 'used', 'to', 'of', 'in', 'for',
    'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
    'during', 'before', 'after', 'above', 'below', 'between',
    'under', 'again', 'further', 'then', 'once', 'here', 'there',
    'when', 'where', 'why', 'how', 'all', 'each', 'few', 'more',
    'most', 'other', 'some', 'such', 'no', 'nor', 'not', 'only',
    'own', 'same', 'so', 'than', 'too', 'very', 'just', 'and',
    'but', 'if', 'or', 'because', 'until', 'while', 'it', 'its',
    'app', 'application', 'error', 'issue', 'problem', 'help',
    'please', 'thanks', 'thank', 'you', 'i', 'my', 'me', 'we'
  ]);

  // Filter meaningful keywords (length > 2 and not stop words)
  const keywords = errorPattern.toLowerCase()
    .split(/[,\s]+/)
    .filter(k => k.length > 2 && !stopWords.has(k));

  // If no meaningful keywords, return null
  if (keywords.length === 0) {
    return null;
  }

  let bestMatch = null;
  let bestScore = 0;

  for (const row of rows) {
    const rowApp = (row.get('application') || '').toLowerCase();
    const rowPattern = (row.get('error_pattern') || '').toLowerCase();

    // Application must match (if specified)
    if (application) {
      const appLower = application.toLowerCase();
      if (!rowApp.includes(appLower) && !appLower.includes(rowApp)) {
        continue;
      }
    }

    // Count matching keywords
    const patternWords = rowPattern.split(/[,\s]+/).filter(w => w.length > 2);
    let matchCount = 0;

    for (const keyword of keywords) {
      const hasMatch = patternWords.some(patternWord =>
        patternWord.includes(keyword) || keyword.includes(patternWord)
      );
      if (hasMatch) matchCount++;
    }

    // Calculate match score (percentage of keywords matched)
    const score = matchCount / keywords.length;

    // Require at least 30% match OR at least 2 keyword matches
    if ((score >= 0.3 || matchCount >= 2) && score > bestScore) {
      bestScore = score;
      bestMatch = row;
    }
  }

  return bestMatch ? rowToObject(bestMatch) : null;
}

// ============================================
// KNOWLEDGE BASE OPERATIONS
// ============================================

/**
 * Get all knowledge base documents
 */
async function getKnowledgeBase() {
  const sheet = await getSheet('knowledge_base');
  const rows = await sheet.getRows();
  return rows.map(rowToObject);
}

/**
 * Get a knowledge base document by ID
 */
async function getKnowledgeDoc(docId) {
  const sheet = await getSheet('knowledge_base');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('doc_id') === docId);
  return row ? rowToObject(row) : null;
}

/**
 * Add a new knowledge base document
 */
async function addKnowledgeDoc(docData) {
  const sheet = await getSheet('knowledge_base');

  // Generate doc_id
  const rows = await sheet.getRows();
  const maxId = rows.reduce((max, row) => {
    const id = row.get('doc_id');
    const num = parseInt(id?.replace('kb_', '') || '0', 10);
    return num > max ? num : max;
  }, 0);
  const docId = `kb_${String(maxId + 1).padStart(2, '0')}`;

  const row = await sheet.addRow({
    doc_id: docId,
    application: docData.application,
    title: docData.title,
    content: docData.content,
    keywords: docData.keywords || ''
  });
  return rowToObject(row);
}

/**
 * Update a knowledge base document
 */
async function updateKnowledgeDoc(docId, updates) {
  const sheet = await getSheet('knowledge_base');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('doc_id') === docId);

  if (!row) {
    return null;
  }

  Object.entries(updates).forEach(([key, value]) => {
    if (key !== 'doc_id') { // Don't allow changing doc_id
      row.set(key, value);
    }
  });

  await row.save();
  return rowToObject(row);
}

/**
 * Delete a knowledge base document
 */
async function deleteKnowledgeDoc(docId) {
  const sheet = await getSheet('knowledge_base');
  const rows = await sheet.getRows();
  const rowIndex = rows.findIndex(r => r.get('doc_id') === docId);

  if (rowIndex === -1) {
    return false;
  }

  await rows[rowIndex].delete();
  return true;
}

// ============================================
// DOCUMENT OPERATIONS
// ============================================

/**
 * Add a new document record
 */
async function addDocument(docData) {
  const sheet = await getSheet('documents');
  const row = await sheet.addRow({
    doc_id: docData.doc_id,
    filename: docData.filename,
    title: docData.title,
    application: docData.application || '',
    upload_date: docData.upload_date || new Date().toISOString(),
    status: docData.status || 'processing',
    chunk_count: docData.chunk_count || 0,
    image_count: docData.image_count || 0,
    file_size: docData.file_size || 0,
    num_pages: docData.num_pages || 0
  });
  return rowToObject(row);
}

/**
 * Get all documents
 */
async function getAllDocuments() {
  try {
    const sheet = await getSheet('documents');
    const rows = await sheet.getRows();
    return rows.map(rowToObject);
  } catch (error) {
    // Sheet might not exist yet
    if (error.message.includes('not found')) {
      return [];
    }
    throw error;
  }
}

/**
 * Get a document by ID
 */
async function getDocument(docId) {
  const sheet = await getSheet('documents');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('doc_id') === docId);
  return row ? rowToObject(row) : null;
}

/**
 * Update a document
 */
async function updateDocument(docId, updates) {
  const sheet = await getSheet('documents');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('doc_id') === docId);

  if (!row) {
    return null;
  }

  Object.entries(updates).forEach(([key, value]) => {
    if (key !== 'doc_id') {
      row.set(key, value);
    }
  });

  await row.save();
  return rowToObject(row);
}

/**
 * Delete a document
 */
async function deleteDocument(docId) {
  const sheet = await getSheet('documents');
  const rows = await sheet.getRows();
  const rowIndex = rows.findIndex(r => r.get('doc_id') === docId);

  if (rowIndex === -1) {
    return false;
  }

  await rows[rowIndex].delete();
  return true;
}

// ============================================
// SETTINGS OPERATIONS
// ============================================

/**
 * Get a single setting by key
 */
async function getSetting(key) {
  const sheet = await getSheet('settings');
  const rows = await sheet.getRows();
  const row = rows.find(r => r.get('setting_key') === key);
  return row ? row.get('setting_value') : null;
}

/**
 * Update or create a setting
 */
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

/**
 * Get all settings as an object
 */
async function getAllSettings() {
  const sheet = await getSheet('settings');
  const rows = await sheet.getRows();
  const settings = {};
  rows.forEach(row => {
    const key = row.get('setting_key');
    if (key) {
      settings[key] = row.get('setting_value');
    }
  });
  return settings;
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Convert a Google Sheets row to a plain object
 */
function rowToObject(row) {
  // Use the built-in toObject method if available
  if (typeof row.toObject === 'function') {
    return row.toObject();
  }

  // Fallback: access raw data
  const obj = {};
  const rawData = row._rawData;
  const headers = row._worksheet ? row._worksheet.headerValues : [];

  if (headers.length > 0) {
    headers.forEach((header, index) => {
      obj[header] = rawData[index] || '';
    });
  }

  return obj;
}

/**
 * Test the connection to Google Sheets
 */
async function testConnection() {
  try {
    await initSheet();
    return {
      success: true,
      spreadsheetTitle: doc.title,
      sheets: Object.keys(doc.sheetsByTitle)
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  // Initialization
  initSheet,
  getSheet,
  testConnection,

  // Tickets
  createTicket,
  getAllTickets,
  getTicketsByStatus,
  getTicketById,
  getOpenTicketsBySession,
  updateTicket,

  // Messages
  addMessage,
  getMessagesBySession,
  getUnreadMessages,
  markMessagesAsRead,

  // Mock Logs
  getMockLog,
  getAllMockLogs,
  findMatchingMockLog,

  // Knowledge Base
  getKnowledgeBase,
  getKnowledgeDoc,
  addKnowledgeDoc,
  updateKnowledgeDoc,
  deleteKnowledgeDoc,

  // Documents
  addDocument,
  getAllDocuments,
  getDocument,
  updateDocument,
  deleteDocument,

  // Settings
  getSetting,
  updateSetting,
  getAllSettings
};
