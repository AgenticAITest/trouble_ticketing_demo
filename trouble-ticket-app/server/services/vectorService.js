/**
 * Vector Database Service
 * Multi-provider embeddings with file-based vector store
 * Supports: OpenAI, Cohere, Jina AI, Ollama (local)
 */
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');
const { getSetting } = require('./googleSheets');
const { decrypt } = require('../middleware/encryption');

// Configuration
const VECTOR_STORE_PATH = path.join(__dirname, '..', 'data', 'vectors.json');

// Embedding provider configurations
const EMBEDDING_PROVIDERS = {
  openai: {
    name: 'OpenAI',
    models: ['text-embedding-3-small', 'text-embedding-3-large', 'text-embedding-ada-002'],
    defaultModel: 'text-embedding-3-small',
    dimensions: { 'text-embedding-3-small': 1536, 'text-embedding-3-large': 3072, 'text-embedding-ada-002': 1536 }
  },
  openrouter: {
    name: 'OpenRouter',
    models: ['openai/text-embedding-3-small', 'openai/text-embedding-3-large', 'openai/text-embedding-ada-002'],
    defaultModel: 'openai/text-embedding-3-small',
    dimensions: { 'openai/text-embedding-3-small': 1536, 'openai/text-embedding-3-large': 3072, 'openai/text-embedding-ada-002': 1536 }
  },
  cohere: {
    name: 'Cohere',
    models: ['embed-english-v3.0', 'embed-multilingual-v3.0', 'embed-english-light-v3.0'],
    defaultModel: 'embed-english-v3.0',
    dimensions: { 'embed-english-v3.0': 1024, 'embed-multilingual-v3.0': 1024, 'embed-english-light-v3.0': 384 }
  },
  jina: {
    name: 'Jina AI',
    models: ['jina-embeddings-v2-base-en', 'jina-embeddings-v2-small-en'],
    defaultModel: 'jina-embeddings-v2-base-en',
    dimensions: { 'jina-embeddings-v2-base-en': 768, 'jina-embeddings-v2-small-en': 512 }
  },
  ollama: {
    name: 'Ollama (Local)',
    models: ['nomic-embed-text', 'all-minilm', 'mxbai-embed-large'],
    defaultModel: 'nomic-embed-text',
    dimensions: { 'nomic-embed-text': 768, 'all-minilm': 384, 'mxbai-embed-large': 1024 }
  }
};

// Ensure data directory exists
const dataDir = path.dirname(VECTOR_STORE_PATH);
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

// In-memory cache
let vectorStore = null;
let embeddingClient = null;
let currentProvider = null;

/**
 * Load vector store from disk
 */
function loadVectorStore() {
  if (vectorStore) return vectorStore;

  try {
    if (fs.existsSync(VECTOR_STORE_PATH)) {
      const data = fs.readFileSync(VECTOR_STORE_PATH, 'utf8');
      vectorStore = JSON.parse(data);
    } else {
      vectorStore = { chunks: [], provider: null, model: null };
    }
  } catch (error) {
    console.error('Error loading vector store:', error);
    vectorStore = { chunks: [], provider: null, model: null };
  }

  return vectorStore;
}

/**
 * Save vector store to disk
 */
function saveVectorStore() {
  try {
    fs.writeFileSync(VECTOR_STORE_PATH, JSON.stringify(vectorStore, null, 2));
  } catch (error) {
    console.error('Error saving vector store:', error);
    throw error;
  }
}

/**
 * Get embedding configuration from settings
 */
async function getEmbeddingConfig() {
  const provider = await getSetting('embedding_provider') || 'openai';
  const model = await getSetting('embedding_model') || EMBEDDING_PROVIDERS[provider]?.defaultModel;
  const useChatKey = await getSetting('embedding_use_chat_key') === 'true';
  const ollamaUrl = await getSetting('ollama_url') || 'http://localhost:11434';

  let apiKey = null;

  if (useChatKey) {
    // Use the chat API key
    const storedKey = await getSetting('api_key');
    if (storedKey) {
      try {
        apiKey = decrypt(storedKey) || storedKey;
      } catch {
        apiKey = storedKey;
      }
    }
  } else {
    // Use dedicated embedding API key
    const embeddingKey = await getSetting('embedding_api_key');
    if (embeddingKey) {
      try {
        apiKey = decrypt(embeddingKey) || embeddingKey;
      } catch {
        apiKey = embeddingKey;
      }
    }
  }

  // Fallback to environment variables
  if (!apiKey) {
    switch (provider) {
      case 'openai':
        apiKey = process.env.OPENAI_API_KEY;
        break;
      case 'openrouter':
        apiKey = process.env.OPENROUTER_API_KEY;
        break;
      case 'cohere':
        apiKey = process.env.COHERE_API_KEY;
        break;
      case 'jina':
        apiKey = process.env.JINA_API_KEY;
        break;
      case 'ollama':
        apiKey = 'not-required'; // Ollama doesn't need API key
        break;
    }
  }

  return { provider, model, apiKey, useChatKey, ollamaUrl };
}

/**
 * Generate embeddings using OpenAI
 */
async function generateOpenAIEmbeddings(texts, apiKey, model) {
  const client = new OpenAI({ apiKey });
  const response = await client.embeddings.create({
    model: model || 'text-embedding-3-small',
    input: texts
  });
  return response.data.map(item => item.embedding);
}

/**
 * Generate embeddings using OpenRouter
 */
async function generateOpenRouterEmbeddings(texts, apiKey, model) {
  const client = new OpenAI({
    apiKey,
    baseURL: 'https://openrouter.ai/api/v1'
  });
  const response = await client.embeddings.create({
    model: model || 'openai/text-embedding-3-small',
    input: texts
  });
  return response.data.map(item => item.embedding);
}

/**
 * Generate embeddings using Cohere
 */
async function generateCohereEmbeddings(texts, apiKey, model) {
  const response = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      texts: texts,
      model: model || 'embed-english-v3.0',
      input_type: 'search_document'
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Cohere API error: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  return data.embeddings;
}

/**
 * Generate embeddings using Jina AI
 */
async function generateJinaEmbeddings(texts, apiKey, model) {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      input: texts,
      model: model || 'jina-embeddings-v2-base-en'
    })
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(`Jina API error: ${error.message || response.statusText}`);
  }

  const data = await response.json();
  return data.data.map(item => item.embedding);
}

/**
 * Generate embeddings using Ollama (local)
 */
async function generateOllamaEmbeddings(texts, ollamaUrl, model) {
  const embeddings = [];

  for (const text of texts) {
    const response = await fetch(`${ollamaUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: model || 'nomic-embed-text',
        prompt: text
      })
    });

    if (!response.ok) {
      throw new Error(`Ollama error: ${response.statusText}. Is Ollama running at ${ollamaUrl}?`);
    }

    const data = await response.json();
    embeddings.push(data.embedding);
  }

  return embeddings;
}

/**
 * Generate embeddings using configured provider
 */
async function generateEmbeddings(texts) {
  const config = await getEmbeddingConfig();
  const inputTexts = Array.isArray(texts) ? texts : [texts];

  if (!config.apiKey && config.provider !== 'ollama') {
    throw new Error(
      `No API key configured for ${EMBEDDING_PROVIDERS[config.provider]?.name || config.provider} embeddings. ` +
      `Please configure in Admin Settings → Embeddings, or set the appropriate environment variable.`
    );
  }

  console.log(`Generating embeddings with ${config.provider}/${config.model} for ${inputTexts.length} texts`);

  switch (config.provider) {
    case 'openai':
      return generateOpenAIEmbeddings(inputTexts, config.apiKey, config.model);
    case 'openrouter':
      return generateOpenRouterEmbeddings(inputTexts, config.apiKey, config.model);
    case 'cohere':
      return generateCohereEmbeddings(inputTexts, config.apiKey, config.model);
    case 'jina':
      return generateJinaEmbeddings(inputTexts, config.apiKey, config.model);
    case 'ollama':
      return generateOllamaEmbeddings(inputTexts, config.ollamaUrl, config.model);
    default:
      throw new Error(`Unknown embedding provider: ${config.provider}`);
  }
}

/**
 * Calculate cosine similarity between two vectors
 */
function cosineSimilarity(a, b) {
  if (a.length !== b.length) {
    console.warn(`Vector dimension mismatch: ${a.length} vs ${b.length}`);
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Initialize the vector store
 */
async function initChroma() {
  loadVectorStore();
  const config = await getEmbeddingConfig();
  console.log(`Vector store initialized: ${vectorStore.chunks.length} chunks, provider: ${config.provider}`);
  return vectorStore;
}

/**
 * Add chunks to vector database
 * @param {Array} chunks - Text chunks to add
 * @param {string} chunkType - Type of chunks: 'text' or 'image' (default: 'text')
 */
async function addChunks(chunks, chunkType = 'text') {
  loadVectorStore();
  const config = await getEmbeddingConfig();

  if (chunks.length === 0) {
    return { success: true, count: 0 };
  }

  // Generate embeddings for all chunks
  const documents = chunks.map(c => c.content);
  console.log(`Generating embeddings for ${documents.length} ${chunkType} chunks using ${config.provider}...`);
  const embeddings = await generateEmbeddings(documents);

  // Add chunks with embeddings to store
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const idSuffix = chunkType === 'image' ? `img_${chunk.index}` : `chunk_${chunk.index}`;
    const id = `${chunk.docId}_${idSuffix}`;

    // Remove existing chunk with same ID if exists
    vectorStore.chunks = vectorStore.chunks.filter(c => c.id !== id);

    const chunkData = {
      id: id,
      content: chunk.content,
      embedding: embeddings[i],
      metadata: {
        type: chunkType,
        docId: chunk.docId,
        chunkIndex: chunk.index,
        tokenCount: chunk.tokenCount,
        source: chunk.metadata?.source || '',
        numPages: chunk.metadata?.numPages || 0,
        application: chunk.application || '',
        // Page number tracking for on-demand PDF page rendering
        pageNumber: chunk.pageNumber || 0,
        startPage: chunk.startPage || 0,
        endPage: chunk.endPage || 0
      }
    };

    // Add image-specific metadata (legacy support)
    if (chunkType === 'image') {
      chunkData.metadata.imagePath = chunk.imagePath || '';
      chunkData.metadata.imageFilename = chunk.imageFilename || '';
    }

    vectorStore.chunks.push(chunkData);
  }

  // Track which provider/model was used
  vectorStore.provider = config.provider;
  vectorStore.model = config.model;

  saveVectorStore();
  console.log(`Added ${chunks.length} ${chunkType} chunks to vector store`);

  return { success: true, count: chunks.length };
}

/**
 * Add image chunks to vector database
 * Images are described first, then the description is embedded
 * @param {Array<{docId: string, imagePath: string, imageFilename: string, description: string, pageNumber: number, index: number, application: string}>} images
 */
async function addImageChunks(images) {
  if (images.length === 0) {
    return { success: true, count: 0 };
  }

  // Convert image data to chunk format
  const imageChunks = images.map(img => ({
    content: img.description,
    docId: img.docId,
    index: img.index,
    tokenCount: Math.ceil(img.description.length / 4),
    imagePath: img.imagePath,
    imageFilename: img.imageFilename,
    pageNumber: img.pageNumber,
    application: img.application,
    metadata: {
      source: img.imageFilename
    }
  }));

  return addChunks(imageChunks, 'image');
}

/**
 * Search for similar chunks
 */
async function search(query, options = {}) {
  loadVectorStore();

  if (vectorStore.chunks.length === 0) {
    return [];
  }

  const limit = options.limit || 5;

  // Generate query embedding
  const queryEmbedding = (await generateEmbeddings(query))[0];

  // Filter chunks by application if specified
  let candidateChunks = vectorStore.chunks;
  if (options.application) {
    candidateChunks = candidateChunks.filter(
      c => c.metadata.application === options.application
    );
  }
  if (options.docId) {
    candidateChunks = candidateChunks.filter(
      c => c.metadata.docId === options.docId
    );
  }

  if (candidateChunks.length === 0) {
    return [];
  }

  // Calculate similarities
  const results = candidateChunks.map(chunk => ({
    id: chunk.id,
    content: chunk.content,
    metadata: chunk.metadata,
    similarity: cosineSimilarity(queryEmbedding, chunk.embedding)
  }));

  // Sort by similarity (descending) and take top results
  results.sort((a, b) => b.similarity - a.similarity);

  return results.slice(0, limit).map(r => ({
    id: r.id,
    content: r.content,
    metadata: r.metadata,
    distance: 1 - r.similarity,
    similarity: r.similarity
  }));
}

/**
 * Delete all chunks for a document
 */
async function deleteDocument(docId) {
  loadVectorStore();

  const initialCount = vectorStore.chunks.length;
  vectorStore.chunks = vectorStore.chunks.filter(
    c => c.metadata.docId !== docId
  );

  saveVectorStore();
  console.log(`Deleted ${initialCount - vectorStore.chunks.length} chunks for document ${docId}`);

  return { success: true };
}

/**
 * Get collection statistics
 */
async function getStats() {
  loadVectorStore();
  const config = await getEmbeddingConfig();

  return {
    collectionName: 'file_based_store',
    totalChunks: vectorStore.chunks.length,
    embeddingProvider: config.provider,
    embeddingModel: config.model,
    storedProvider: vectorStore.provider,
    storedModel: vectorStore.model
  };
}

/**
 * Clear all data from the store
 */
async function clearAll() {
  vectorStore = { chunks: [], provider: null, model: null };
  saveVectorStore();
  return { success: true };
}

/**
 * Get available embedding providers
 */
function getAvailableProviders() {
  return EMBEDDING_PROVIDERS;
}

/**
 * Test embedding connection
 */
async function testConnection(testConfig = {}) {
  try {
    const config = await getEmbeddingConfig();
    const provider = testConfig.provider || config.provider;
    const model = testConfig.model || config.model;
    const apiKey = testConfig.apiKey || config.apiKey;
    const ollamaUrl = testConfig.ollamaUrl || config.ollamaUrl;

    const testText = ['Test embedding connection'];
    let embeddings;

    switch (provider) {
      case 'openai':
        embeddings = await generateOpenAIEmbeddings(testText, apiKey, model);
        break;
      case 'openrouter':
        embeddings = await generateOpenRouterEmbeddings(testText, apiKey, model);
        break;
      case 'cohere':
        embeddings = await generateCohereEmbeddings(testText, apiKey, model);
        break;
      case 'jina':
        embeddings = await generateJinaEmbeddings(testText, apiKey, model);
        break;
      case 'ollama':
        embeddings = await generateOllamaEmbeddings(testText, ollamaUrl, model);
        break;
      default:
        throw new Error(`Unknown provider: ${provider}`);
    }

    return {
      success: true,
      message: 'Connection successful',
      provider,
      model,
      dimensions: embeddings[0].length
    };
  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}

module.exports = {
  initChroma,
  generateEmbeddings,
  addChunks,
  addImageChunks,
  search,
  deleteDocument,
  getStats,
  clearAll,
  getAvailableProviders,
  testConnection,
  getEmbeddingConfig
};
