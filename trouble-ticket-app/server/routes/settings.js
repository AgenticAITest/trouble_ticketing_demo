/**
 * Settings API routes
 * Handles admin settings configuration
 */
const express = require('express');
const router = express.Router();
const { requireRole } = require('../middleware/auth');
const { settingsRules, validateRequest } = require('../middleware/validate');
const { encrypt, decrypt } = require('../middleware/encryption');
const googleSheets = require('../services/googleSheets');
const llmService = require('../services/llmService');
const vectorService = require('../services/vectorService');
const { getDefaultSystemPrompt } = require('../prompts/systemPrompt');

// Apply admin auth to all settings routes
router.use(requireRole('admin'));

/**
 * GET /api/settings
 * Get all settings (API key is masked)
 */
router.get('/', async (req, res) => {
  try {
    const settings = await googleSheets.getAllSettings();

    // Mask API key for display
    if (settings.api_key) {
      let keyToMask = settings.api_key;

      // Try to decrypt - if it fails, assume it's not encrypted
      try {
        const decrypted = decrypt(settings.api_key);
        if (decrypted && decrypted.length > 0) {
          keyToMask = decrypted;
        }
      } catch {
        // Not encrypted, use as-is
      }

      if (keyToMask && keyToMask.length > 12) {
        settings.api_key_masked = `${keyToMask.substring(0, 8)}...${keyToMask.substring(keyToMask.length - 4)}`;
      } else if (keyToMask) {
        settings.api_key_masked = '(key configured)';
      } else {
        settings.api_key_masked = '';
      }

      delete settings.api_key; // Don't send actual key
    }

    // Remove password hashes from response
    delete settings.it_support_password_hash;
    delete settings.admin_password_hash;

    res.json(settings);
  } catch (error) {
    console.error('Settings fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

/**
 * PUT /api/settings/api
 * Update API provider settings
 */
router.put('/api', settingsRules, validateRequest, async (req, res) => {
  try {
    const { provider, apiKey, model, baseUrl } = req.body;

    if (provider) {
      await googleSheets.updateSetting('api_provider', provider);
    }

    if (apiKey) {
      // Encrypt API key before storing
      const encryptedKey = encrypt(apiKey);
      await googleSheets.updateSetting('api_key', encryptedKey);
    }

    if (model) {
      await googleSheets.updateSetting('api_model', model);
    }

    if (baseUrl !== undefined) {
      await googleSheets.updateSetting('api_base_url', baseUrl || '');
    }

    res.json({ success: true, message: 'API settings updated' });
  } catch (error) {
    console.error('Settings update error:', error);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

/**
 * POST /api/settings/test-api
 * Test API connection with provided or stored credentials
 */
router.post('/test-api', async (req, res) => {
  try {
    const { provider, apiKey, model, baseUrl } = req.body;

    // Build test config
    const testConfig = {};
    if (provider) testConfig.provider = provider;
    if (apiKey) testConfig.apiKey = apiKey;
    if (model) testConfig.model = model;
    if (baseUrl) testConfig.baseUrl = baseUrl;

    // Use LLM service to test connection
    const result = await llmService.testConnection(testConfig);

    res.json(result);
  } catch (error) {
    console.error('API test error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Connection test failed'
    });
  }
});

/**
 * GET /api/settings/system-prompt
 * Get the current system prompt (custom or default)
 */
router.get('/system-prompt', async (req, res) => {
  try {
    const customPrompt = await googleSheets.getSetting('system_prompt');
    const defaultPrompt = getDefaultSystemPrompt();

    res.json({
      customPrompt: customPrompt || '',
      defaultPrompt: defaultPrompt,
      isCustom: !!customPrompt
    });
  } catch (error) {
    console.error('Get system prompt error:', error);
    res.status(500).json({ error: 'Failed to fetch system prompt' });
  }
});

/**
 * PUT /api/settings/system-prompt
 * Update the system prompt
 */
router.put('/system-prompt', async (req, res) => {
  try {
    const { prompt } = req.body;

    if (prompt === undefined) {
      return res.status(400).json({ error: 'Prompt is required' });
    }

    // Save empty string to reset to default, otherwise save custom prompt
    await googleSheets.updateSetting('system_prompt', prompt);

    res.json({
      success: true,
      message: prompt ? 'System prompt updated' : 'System prompt reset to default'
    });
  } catch (error) {
    console.error('Update system prompt error:', error);
    res.status(500).json({ error: 'Failed to update system prompt' });
  }
});

// ============================================
// EMBEDDING SETTINGS
// ============================================

/**
 * GET /api/settings/embedding-providers
 * Get available embedding providers and their models
 */
router.get('/embedding-providers', async (req, res) => {
  try {
    const providers = vectorService.getAvailableProviders();
    res.json(providers);
  } catch (error) {
    console.error('Get embedding providers error:', error);
    res.status(500).json({ error: 'Failed to get providers' });
  }
});

/**
 * GET /api/settings/embeddings
 * Get embedding configuration
 */
router.get('/embeddings', async (req, res) => {
  try {
    const config = await vectorService.getEmbeddingConfig();
    const stats = await vectorService.getStats();

    // Mask API key
    let apiKeyMasked = '';
    if (config.apiKey && config.apiKey !== 'not-required') {
      if (config.apiKey.length > 12) {
        apiKeyMasked = `${config.apiKey.substring(0, 8)}...${config.apiKey.substring(config.apiKey.length - 4)}`;
      } else {
        apiKeyMasked = '(key configured)';
      }
    }

    res.json({
      provider: config.provider,
      model: config.model,
      useChatKey: config.useChatKey,
      ollamaUrl: config.ollamaUrl,
      apiKeyMasked: apiKeyMasked,
      stats: stats
    });
  } catch (error) {
    console.error('Get embedding settings error:', error);
    res.status(500).json({ error: 'Failed to get embedding settings' });
  }
});

/**
 * PUT /api/settings/embeddings
 * Update embedding configuration
 */
router.put('/embeddings', async (req, res) => {
  try {
    const { provider, model, apiKey, useChatKey, ollamaUrl } = req.body;

    if (provider) {
      await googleSheets.updateSetting('embedding_provider', provider);
    }

    if (model) {
      await googleSheets.updateSetting('embedding_model', model);
    }

    if (useChatKey !== undefined) {
      await googleSheets.updateSetting('embedding_use_chat_key', useChatKey ? 'true' : 'false');
    }

    if (apiKey) {
      const encryptedKey = encrypt(apiKey);
      await googleSheets.updateSetting('embedding_api_key', encryptedKey);
    }

    if (ollamaUrl !== undefined) {
      await googleSheets.updateSetting('ollama_url', ollamaUrl || 'http://localhost:11434');
    }

    res.json({ success: true, message: 'Embedding settings updated' });
  } catch (error) {
    console.error('Update embedding settings error:', error);
    res.status(500).json({ error: 'Failed to update embedding settings' });
  }
});

/**
 * POST /api/settings/test-embeddings
 * Test embedding connection
 */
router.post('/test-embeddings', async (req, res) => {
  try {
    const { provider, model, apiKey, ollamaUrl } = req.body;

    const testConfig = {};
    if (provider) testConfig.provider = provider;
    if (model) testConfig.model = model;
    if (apiKey) testConfig.apiKey = apiKey;
    if (ollamaUrl) testConfig.ollamaUrl = ollamaUrl;

    const result = await vectorService.testConnection(testConfig);
    res.json(result);
  } catch (error) {
    console.error('Embedding test error:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'Connection test failed'
    });
  }
});

module.exports = router;
