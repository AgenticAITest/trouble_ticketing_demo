/**
 * Document Processing Service
 * Handles PDF text extraction and text chunking
 */
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');

// Chunking configuration
const DEFAULT_CHUNK_SIZE = 500; // tokens (approx 4 chars per token)
const DEFAULT_CHUNK_OVERLAP = 50;

/**
 * Extract text from a PDF file
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<{text: string, numPages: number, info: object}>}
 */
async function extractTextFromPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  const options = {
    // Preserve more text structure
    normalizeWhitespace: true,
    disableCombineTextItems: false
  };

  const data = await pdfParse(dataBuffer, options);

  return {
    text: data.text,
    numPages: data.numpages,
    info: data.info || {}
  };
}

/**
 * Clean and normalize extracted text
 * @param {string} text - Raw extracted text
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
  return text
    // Normalize whitespace
    .replace(/\s+/g, ' ')
    // Remove excessive newlines
    .replace(/\n{3,}/g, '\n\n')
    // Trim
    .trim();
}

/**
 * Estimate token count (rough approximation: ~4 chars per token)
 * @param {string} text
 * @returns {number}
 */
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

/**
 * Split text into chunks with overlap
 * @param {string} text - Text to chunk
 * @param {object} options - Chunking options
 * @returns {Array<{content: string, index: number, tokenCount: number}>}
 */
function chunkText(text, options = {}) {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap || DEFAULT_CHUNK_OVERLAP;

  // Target character count (approx 4 chars per token)
  const targetChars = chunkSize * 4;
  const overlapChars = overlap * 4;

  const cleanedText = cleanText(text);

  // Split by paragraphs first to preserve semantic units
  const paragraphs = cleanedText.split(/\n\n+/);

  const chunks = [];
  let currentChunk = '';
  let chunkIndex = 0;

  for (const paragraph of paragraphs) {
    // If adding this paragraph exceeds target, start new chunk
    if (currentChunk.length + paragraph.length > targetChars && currentChunk.length > 0) {
      chunks.push({
        content: currentChunk.trim(),
        index: chunkIndex,
        tokenCount: estimateTokens(currentChunk)
      });

      // Keep overlap from end of current chunk
      if (overlapChars > 0) {
        const words = currentChunk.split(' ');
        const overlapWords = [];
        let overlapLen = 0;

        for (let i = words.length - 1; i >= 0 && overlapLen < overlapChars; i--) {
          overlapWords.unshift(words[i]);
          overlapLen += words[i].length + 1;
        }

        currentChunk = overlapWords.join(' ') + ' ';
      } else {
        currentChunk = '';
      }

      chunkIndex++;
    }

    currentChunk += paragraph + '\n\n';
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      index: chunkIndex,
      tokenCount: estimateTokens(currentChunk)
    });
  }

  return chunks;
}

/**
 * Process a PDF document - extract and chunk
 * @param {string} filePath - Path to PDF
 * @param {string} docId - Document ID
 * @param {object} options - Processing options
 * @returns {Promise<{chunks: Array, metadata: object}>}
 */
async function processDocument(filePath, docId, options = {}) {
  // Extract text
  const extracted = await extractTextFromPDF(filePath);

  // Chunk the text
  const chunks = chunkText(extracted.text, options);

  // Add document metadata to each chunk
  const enrichedChunks = chunks.map(chunk => ({
    ...chunk,
    docId: docId,
    metadata: {
      source: path.basename(filePath),
      numPages: extracted.numPages,
      pdfInfo: extracted.info
    }
  }));

  return {
    chunks: enrichedChunks,
    metadata: {
      docId: docId,
      filename: path.basename(filePath),
      numPages: extracted.numPages,
      totalChunks: chunks.length,
      totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
      extractedTextLength: extracted.text.length,
      pdfInfo: extracted.info
    }
  };
}

/**
 * Delete uploaded file
 * @param {string} filePath
 */
function deleteFile(filePath) {
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
}

module.exports = {
  extractTextFromPDF,
  cleanText,
  chunkText,
  processDocument,
  deleteFile,
  estimateTokens
};
