/**
 * Multi-provider LLM Service
 * Supports Anthropic, OpenAI, OpenRouter, and custom OpenAI-compatible endpoints
 */
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { getSetting } = require('./googleSheets');
const { decrypt } = require('../middleware/encryption');

// Provider configurations
const PROVIDERS = {
  anthropic: {
    name: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    models: ['claude-sonnet-4-20250514', 'claude-3-haiku-20240307', 'claude-3-opus-20240229']
  },
  openai: {
    name: 'OpenAI',
    defaultModel: 'gpt-4o',
    models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo', 'gpt-3.5-turbo']
  },
  openrouter: {
    name: 'OpenRouter',
    defaultModel: 'anthropic/claude-3.5-sonnet',
    models: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'google/gemini-pro']
  },
  custom: {
    name: 'Custom/Local',
    defaultModel: '',
    models: []
  }
};

/**
 * Retry helper with exponential backoff
 */
async function withRetry(fn, retries = 3, delayMs = 1000) {
  for (let attempt = 0; attempt < retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      const isLastAttempt = attempt === retries - 1;
      if (isLastAttempt) throw error;

      // Don't retry on auth errors
      if (error.status === 401 || error.status === 403) throw error;

      const delay = delayMs * Math.pow(2, attempt);
      console.warn(`LLM API call failed (attempt ${attempt + 1}/${retries}), retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Get provider configuration from settings
 */
async function getProviderConfig() {
  const provider = await getSetting('api_provider') || 'anthropic';
  const storedKey = await getSetting('api_key');
  const model = await getSetting('api_model') || PROVIDERS[provider]?.defaultModel;
  const baseUrl = await getSetting('api_base_url');

  // Try to decrypt the key, if it fails fall back to environment variables
  let apiKey = null;
  if (storedKey) {
    try {
      const decrypted = decrypt(storedKey);
      apiKey = decrypted || null;
    } catch (e) {
      console.error('Decryption error:', e.message);
      // Decryption failed - key was encrypted with different key, fall back to env
      apiKey = null;
    }
  }

  // Fallback to environment variable based on provider
  if (!apiKey) {
    switch (provider) {
      case 'openrouter':
        apiKey = process.env.OPENROUTER_API_KEY;
        break;
      case 'openai':
        apiKey = process.env.OPENAI_API_KEY;
        break;
      case 'anthropic':
        apiKey = process.env.ANTHROPIC_API_KEY;
        break;
      default:
        apiKey = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || process.env.OPENROUTER_API_KEY;
    }
  }

  return { provider, apiKey, model, baseUrl };
}

/**
 * Send a message to the LLM and get a response
 */
async function sendMessage(userMessage, conversationHistory, knowledgeBase, systemPrompt) {
  const config = await getProviderConfig();

  if (!config.apiKey) {
    throw new Error('No API key configured. Please set up the API key in Admin Settings.');
  }

  return withRetry(async () => {
    switch (config.provider) {
      case 'anthropic':
        return sendAnthropicMessage(config, userMessage, conversationHistory, systemPrompt);
      case 'openai':
        return sendOpenAIMessage(config, userMessage, conversationHistory, systemPrompt);
      case 'openrouter':
        return sendOpenRouterMessage(config, userMessage, conversationHistory, systemPrompt);
      case 'custom':
        return sendOpenAICompatibleMessage(config, userMessage, conversationHistory, systemPrompt);
      default:
        throw new Error(`Unsupported provider: ${config.provider}`);
    }
  });
}

/**
 * Send message via Anthropic API
 */
async function sendAnthropicMessage(config, userMessage, conversationHistory, systemPrompt) {
  const client = new Anthropic({ apiKey: config.apiKey });

  // Build messages array from history
  const messages = conversationHistory.map(msg => ({
    role: msg.sender === 'user' ? 'user' : 'assistant',
    content: msg.content
  }));

  // Add current message
  messages.push({ role: 'user', content: userMessage });

  const response = await client.messages.create({
    model: config.model || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages
  });

  return response.content[0].text;
}

/**
 * Send message via OpenAI API
 */
async function sendOpenAIMessage(config, userMessage, conversationHistory, systemPrompt) {
  const client = new OpenAI({ apiKey: config.apiKey });

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  conversationHistory.forEach(msg => {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content
    });
  });

  messages.push({ role: 'user', content: userMessage });

  const response = await client.chat.completions.create({
    model: config.model || 'gpt-4o',
    messages: messages,
    max_tokens: 2048
  });

  return response.choices[0].message.content;
}

/**
 * Send message via OpenRouter API
 */
async function sendOpenRouterMessage(config, userMessage, conversationHistory, systemPrompt) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: 'https://openrouter.ai/api/v1'
  });

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  conversationHistory.forEach(msg => {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content
    });
  });

  messages.push({ role: 'user', content: userMessage });

  const response = await client.chat.completions.create({
    model: config.model || 'anthropic/claude-3.5-sonnet',
    messages: messages,
    max_tokens: 2048
  });

  return response.choices[0].message.content;
}

/**
 * Send message via custom OpenAI-compatible API
 */
async function sendOpenAICompatibleMessage(config, userMessage, conversationHistory, systemPrompt) {
  if (!config.baseUrl) {
    throw new Error('Base URL is required for custom provider');
  }

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: config.baseUrl
  });

  const messages = [
    { role: 'system', content: systemPrompt }
  ];

  conversationHistory.forEach(msg => {
    messages.push({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content
    });
  });

  messages.push({ role: 'user', content: userMessage });

  const response = await client.chat.completions.create({
    model: config.model,
    messages: messages,
    max_tokens: 2048
  });

  return response.choices[0].message.content;
}

/**
 * Test LLM connection with provided or stored credentials
 */
async function testConnection(testConfig = {}) {
  const config = await getProviderConfig();

  // Override with test config if provided
  const provider = testConfig.provider || config.provider;
  const model = testConfig.model || config.model;
  const baseUrl = testConfig.baseUrl || config.baseUrl;

  let apiKey = testConfig.apiKey;
  if (!apiKey && config.apiKey) {
    apiKey = config.apiKey;
  }

  if (!apiKey) {
    return { success: false, error: 'No API key provided' };
  }

  const testMessage = 'Say "Connection successful!" and nothing else.';

  try {
    let response;

    switch (provider) {
      case 'anthropic': {
        const client = new Anthropic({ apiKey });
        const result = await client.messages.create({
          model: model || 'claude-sonnet-4-20250514',
          max_tokens: 50,
          messages: [{ role: 'user', content: testMessage }]
        });
        response = result.content[0].text;
        break;
      }

      case 'openai': {
        const client = new OpenAI({ apiKey });
        const result = await client.chat.completions.create({
          model: model || 'gpt-4o-mini',
          messages: [{ role: 'user', content: testMessage }],
          max_tokens: 50
        });
        response = result.choices[0].message.content;
        break;
      }

      case 'openrouter': {
        const client = new OpenAI({
          apiKey,
          baseURL: 'https://openrouter.ai/api/v1'
        });
        const result = await client.chat.completions.create({
          model: model || 'anthropic/claude-3.5-sonnet',
          messages: [{ role: 'user', content: testMessage }],
          max_tokens: 50
        });
        response = result.choices[0].message.content;
        break;
      }

      case 'custom': {
        if (!baseUrl) {
          return { success: false, error: 'Base URL required for custom provider' };
        }
        const client = new OpenAI({ apiKey, baseURL: baseUrl });
        const result = await client.chat.completions.create({
          model: model,
          messages: [{ role: 'user', content: testMessage }],
          max_tokens: 50
        });
        response = result.choices[0].message.content;
        break;
      }

      default:
        return { success: false, error: `Unknown provider: ${provider}` };
    }

    return {
      success: true,
      message: 'Connection successful',
      response: response.substring(0, 100),
      provider,
      model
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || 'Connection failed',
      provider,
      model
    };
  }
}

/**
 * Get available providers configuration
 */
function getAvailableProviders() {
  return PROVIDERS;
}

/**
 * Describe an image using a vision-capable LLM
 * @param {string} imagePath - Path to the image file
 * @param {string} customModel - Optional custom vision model
 * @returns {Promise<string>} - Text description of the image
 */
async function describeImage(imagePath, customModel = null) {
  const config = await getProviderConfig();
  const fs = require('fs');
  const path = require('path');

  // Read image and convert to base64
  const imageBuffer = fs.readFileSync(imagePath);
  const base64Image = imageBuffer.toString('base64');

  // Determine image mime type from extension
  const ext = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

  // Default vision model (cost-effective options)
  const visionModel = customModel || 'openai/gpt-4o-mini';

  const prompt = `Describe this image in detail for document search purposes. Focus on:
1. What the image shows (diagrams, screenshots, charts, text, etc.)
2. Any visible text or labels
3. Key visual elements and their relationships
4. Technical details if it's a software interface or diagram

Keep the description factual and searchable. Be concise but thorough.`;

  return withRetry(async () => {
    // Use OpenRouter for vision as it provides access to multiple vision models
    const OpenAI = require('openai');
    const client = new OpenAI({
      apiKey: config.apiKey,
      baseURL: 'https://openrouter.ai/api/v1'
    });

    const response = await client.chat.completions.create({
      model: visionModel,
      max_tokens: 500,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: prompt
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${mimeType};base64,${base64Image}`,
                detail: 'low' // Use low detail to reduce cost
              }
            }
          ]
        }
      ]
    });

    return response.choices[0].message.content;
  }, 2, 2000); // Fewer retries for vision calls
}

/**
 * Send a message with an image to a vision-capable LLM
 * @param {string} userMessage - The user's text message
 * @param {string} imageBase64 - Base64 encoded image data
 * @param {string} mimeType - Image MIME type (image/png, image/jpeg, etc.)
 * @param {Array} conversationHistory - Previous messages
 * @param {string} systemPrompt - System prompt for the AI
 * @returns {Promise<string>} - AI response text
 */
async function sendMessageWithImage(userMessage, imageBase64, mimeType, conversationHistory, systemPrompt) {
  const config = await getProviderConfig();

  if (!config.apiKey) {
    throw new Error('No API key configured. Please set up the API key in Admin Settings.');
  }

  return withRetry(async () => {
    // Build conversation history (text only for previous messages)
    const previousMessages = conversationHistory.map(msg => ({
      role: msg.sender === 'user' ? 'user' : 'assistant',
      content: msg.content
    }));

    // The current message includes both text and image
    const userContent = [
      {
        type: 'text',
        text: userMessage || 'Please analyze this image and help me troubleshoot the issue shown.'
      },
      {
        type: 'image_url',
        image_url: {
          url: `data:${mimeType};base64,${imageBase64}`,
          detail: 'high'
        }
      }
    ];

    switch (config.provider) {
      case 'anthropic':
        return sendAnthropicMessageWithImage(config, previousMessages, userContent, systemPrompt);
      case 'openai':
        return sendOpenAIMessageWithImage(config, previousMessages, userContent, systemPrompt);
      case 'openrouter':
        return sendOpenRouterMessageWithImage(config, previousMessages, userContent, systemPrompt);
      default:
        throw new Error(`Provider ${config.provider} does not support vision. Please use OpenAI, Anthropic, or OpenRouter.`);
    }
  });
}

/**
 * Send message with image via Anthropic API
 */
async function sendAnthropicMessageWithImage(config, previousMessages, userContent, systemPrompt) {
  const client = new Anthropic({ apiKey: config.apiKey });

  // Convert user content to Anthropic format
  const anthropicContent = userContent.map(item => {
    if (item.type === 'text') {
      return { type: 'text', text: item.text };
    } else if (item.type === 'image_url') {
      // Extract base64 data and media type from data URL
      const dataUrl = item.image_url.url;
      const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (matches) {
        return {
          type: 'image',
          source: {
            type: 'base64',
            media_type: matches[1],
            data: matches[2]
          }
        };
      }
    }
    return item;
  });

  // Build messages
  const messages = [...previousMessages, { role: 'user', content: anthropicContent }];

  const response = await client.messages.create({
    model: config.model || 'claude-sonnet-4-20250514',
    max_tokens: 2048,
    system: systemPrompt,
    messages: messages
  });

  return response.content[0].text;
}

/**
 * Send message with image via OpenAI API
 */
async function sendOpenAIMessageWithImage(config, previousMessages, userContent, systemPrompt) {
  const client = new OpenAI({ apiKey: config.apiKey });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...previousMessages,
    { role: 'user', content: userContent }
  ];

  // Use a vision-capable model
  const visionModel = config.model?.includes('gpt-4') ? config.model : 'gpt-4o';

  const response = await client.chat.completions.create({
    model: visionModel,
    messages: messages,
    max_tokens: 2048
  });

  return response.choices[0].message.content;
}

/**
 * Send message with image via OpenRouter API
 */
async function sendOpenRouterMessageWithImage(config, previousMessages, userContent, systemPrompt) {
  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: 'https://openrouter.ai/api/v1'
  });

  const messages = [
    { role: 'system', content: systemPrompt },
    ...previousMessages,
    { role: 'user', content: userContent }
  ];

  // Use a vision-capable model via OpenRouter
  let visionModel = config.model || 'openai/gpt-4o';
  // If current model doesn't support vision, switch to one that does
  if (!visionModel.includes('gpt-4') && !visionModel.includes('claude-3') && !visionModel.includes('gemini')) {
    visionModel = 'openai/gpt-4o';
  }

  const response = await client.chat.completions.create({
    model: visionModel,
    messages: messages,
    max_tokens: 2048
  });

  return response.choices[0].message.content;
}

module.exports = {
  sendMessage,
  sendMessageWithImage,
  testConnection,
  getAvailableProviders,
  getProviderConfig,
  describeImage
};
