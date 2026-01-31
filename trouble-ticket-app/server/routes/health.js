/**
 * Health check endpoint
 * Returns status of all services
 */
const express = require('express');
const router = express.Router();
const googleSheets = require('../services/googleSheets');

router.get('/', async (req, res) => {
  const status = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    services: {}
  };

  // Check Google Sheets connection
  try {
    const sheetsTest = await googleSheets.testConnection();
    if (sheetsTest.success) {
      status.services.googleSheets = {
        status: 'connected',
        spreadsheet: sheetsTest.spreadsheetTitle,
        sheets: sheetsTest.sheets
      };
    } else {
      status.services.googleSheets = {
        status: 'disconnected',
        error: sheetsTest.error
      };
      status.status = 'degraded';
    }
  } catch (error) {
    status.services.googleSheets = {
      status: 'error',
      error: error.message
    };
    status.status = 'degraded';
  }

  // Check LLM configuration
  try {
    const provider = await googleSheets.getSetting('api_provider');
    const model = await googleSheets.getSetting('api_model');
    const hasApiKey = !!(await googleSheets.getSetting('api_key'));

    status.services.llm = {
      status: hasApiKey ? 'configured' : 'not_configured',
      provider: provider || 'not_set',
      model: model || 'not_set'
    };

    if (!hasApiKey) {
      status.status = 'degraded';
    }
  } catch (error) {
    status.services.llm = {
      status: 'error',
      error: error.message
    };
    status.status = 'degraded';
  }

  const httpStatus = status.status === 'ok' ? 200 : 503;
  res.status(httpStatus).json(status);
});

module.exports = router;
