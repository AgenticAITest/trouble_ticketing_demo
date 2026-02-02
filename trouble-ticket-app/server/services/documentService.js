/**
 * Document Processing Service
 * Handles PDF text extraction, text chunking, and image extraction
 */
const fs = require('fs');
const path = require('path');
const pdfParse = require('pdf-parse');
const sharp = require('sharp');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const execFileAsync = promisify(execFile);

// In-memory cache for rendered pages (prevents race conditions)
const renderCache = new Map();
const CACHE_MAX_SIZE = 100;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Image storage directory
const IMAGES_DIR = path.join(__dirname, '..', 'data', 'images');

// Ensure images directory exists
if (!fs.existsSync(IMAGES_DIR)) {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
}

// Chunking configuration
const DEFAULT_CHUNK_SIZE = 500; // tokens (approx 4 chars per token)
const DEFAULT_CHUNK_OVERLAP = 50;

/**
 * Extract text from a PDF file with page-level tracking
 * @param {string} filePath - Path to the PDF file
 * @returns {Promise<{text: string, numPages: number, info: object, pageTexts: Array<{page: number, text: string}>}>}
 */
async function extractTextFromPDF(filePath) {
  const dataBuffer = fs.readFileSync(filePath);

  // Track text per page
  const pageTexts = [];
  let currentPage = 0;

  const options = {
    // Preserve more text structure
    normalizeWhitespace: true,
    disableCombineTextItems: false,
    // Custom page render to track page boundaries
    pagerender: function(pageData) {
      currentPage++;
      return pageData.getTextContent().then(function(textContent) {
        let pageText = '';
        let lastY = null;

        for (const item of textContent.items) {
          // Add newline when y position changes significantly (new line)
          if (lastY !== null && Math.abs(item.transform[5] - lastY) > 5) {
            pageText += '\n';
          }
          pageText += item.str;
          lastY = item.transform[5];
        }

        pageTexts.push({
          page: currentPage,
          text: pageText
        });

        return pageText;
      });
    }
  };

  const data = await pdfParse(dataBuffer, options);

  return {
    text: data.text,
    numPages: data.numpages,
    info: data.info || {},
    pageTexts: pageTexts
  };
}

/**
 * Clean and normalize extracted text
 * @param {string} text - Raw extracted text
 * @returns {string} - Cleaned text
 */
function cleanText(text) {
  return text
    // First, normalize line endings
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Normalize multiple newlines to double newlines (paragraph breaks)
    .replace(/\n{3,}/g, '\n\n')
    // Normalize horizontal whitespace (spaces, tabs) within lines - NOT newlines
    .replace(/[^\S\n]+/g, ' ')
    // Remove spaces at the beginning/end of lines
    .replace(/ *\n */g, '\n')
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
 * Split text into chunks with page number tracking (token-based)
 * @param {Array<{page: number, text: string}>} pageTexts - Text per page
 * @param {object} options - Chunking options
 * @returns {Array<{content: string, index: number, tokenCount: number, pageNumber: number, startPage: number, endPage: number}>}
 */
function chunkTextWithPages(pageTexts, options = {}) {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const overlap = options.overlap || DEFAULT_CHUNK_OVERLAP;

  // Target character count (approx 4 chars per token)
  const targetChars = chunkSize * 4;
  const overlapChars = overlap * 4;

  const chunks = [];
  let currentChunk = '';
  let chunkIndex = 0;
  let currentStartPage = 1;
  let currentEndPage = 1;

  for (const pageData of pageTexts) {
    const cleanedPageText = cleanText(pageData.text);
    const paragraphs = cleanedPageText.split(/\n\n+/);

    for (const paragraph of paragraphs) {
      if (!paragraph.trim()) continue;

      // If adding this paragraph exceeds target, start new chunk
      if (currentChunk.length + paragraph.length > targetChars && currentChunk.length > 0) {
        chunks.push({
          content: currentChunk.trim(),
          index: chunkIndex,
          tokenCount: estimateTokens(currentChunk),
          pageNumber: currentStartPage, // Primary page for this chunk
          startPage: currentStartPage,
          endPage: currentEndPage
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
        // New chunk starts at current page
        currentStartPage = pageData.page;
        currentEndPage = pageData.page;
      }

      currentChunk += paragraph + '\n\n';
      currentEndPage = pageData.page; // Update end page as we add content
    }
  }

  // Don't forget the last chunk
  if (currentChunk.trim().length > 0) {
    chunks.push({
      content: currentChunk.trim(),
      index: chunkIndex,
      tokenCount: estimateTokens(currentChunk),
      pageNumber: currentStartPage,
      startPage: currentStartPage,
      endPage: currentEndPage
    });
  }

  return chunks;
}

/**
 * Create one chunk per PDF page for accurate page number tracking
 * @param {Array<{page: number, text: string}>} pageTexts - Text per page
 * @param {object} options - Chunking options
 * @returns {Array<{content: string, index: number, tokenCount: number, pageNumber: number, startPage: number, endPage: number}>}
 */
function chunkByPages(pageTexts, options = {}) {
  const minContentLength = options.minContentLength || 50; // Skip near-empty pages

  const chunks = [];
  let chunkIndex = 0;

  for (const pageData of pageTexts) {
    const content = cleanText(pageData.text);

    // Skip pages with insufficient content
    if (content.length < minContentLength) {
      console.log(`Skipping page ${pageData.page} - insufficient content (${content.length} chars)`);
      continue;
    }

    chunks.push({
      content: content,
      index: chunkIndex,
      tokenCount: estimateTokens(content),
      pageNumber: pageData.page,
      startPage: pageData.page,
      endPage: pageData.page
    });

    chunkIndex++;
  }

  return chunks;
}

/**
 * Extract text from a Markdown file
 * @param {string} filePath - Path to the Markdown file
 * @returns {Promise<{text: string}>}
 */
async function extractTextFromMarkdown(filePath) {
  const text = fs.readFileSync(filePath, 'utf-8');
  return { text };
}

/**
 * Split markdown text into chunks by headers for FAQ-style documents
 * @param {string} text - Markdown text
 * @param {object} options - Chunking options
 * @returns {Array<{content: string, index: number, tokenCount: number, header: string, sectionIndex: number}>}
 */
function chunkByHeaders(text, options = {}) {
  const minContentLength = options.minContentLength || 50;

  // Split by markdown headers (# ## ### etc.)
  const headerRegex = /^(#{1,6})\s+(.+)$/gm;
  const sections = [];
  let lastIndex = 0;
  let lastHeader = 'Introduction';
  let lastHeaderLevel = 0;

  // Find all headers and their positions
  let match;
  const matches = [];
  while ((match = headerRegex.exec(text)) !== null) {
    matches.push({
      fullMatch: match[0],
      level: match[1].length,
      headerText: match[2].trim(),
      index: match.index,
      endIndex: match.index + match[0].length
    });
  }

  // Process each section
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];

    // Get content between this header and the next (or end of text)
    const contentStart = currentMatch.endIndex;
    const contentEnd = nextMatch ? nextMatch.index : text.length;
    const content = text.slice(contentStart, contentEnd).trim();

    if (content.length >= minContentLength) {
      sections.push({
        header: currentMatch.headerText,
        headerLevel: currentMatch.level,
        content: content
      });
    }
  }

  // Check for content before the first header
  if (matches.length > 0 && matches[0].index > 0) {
    const preamble = text.slice(0, matches[0].index).trim();
    if (preamble.length >= minContentLength) {
      sections.unshift({
        header: 'Introduction',
        headerLevel: 1,
        content: preamble
      });
    }
  } else if (matches.length === 0) {
    // No headers found - treat entire document as one section
    const cleanedText = cleanText(text);
    if (cleanedText.length >= minContentLength) {
      sections.push({
        header: 'Document',
        headerLevel: 1,
        content: cleanedText
      });
    }
  }

  // Convert to chunk format
  return sections.map((section, index) => ({
    content: `## ${section.header}\n\n${section.content}`,
    index: index,
    tokenCount: estimateTokens(section.content),
    header: section.header,
    sectionIndex: index + 1,
    // No pageNumber for markdown - use section index
    pageNumber: null,
    startPage: null,
    endPage: null
  }));
}

/**
 * Process a document (PDF or Markdown) - extract and chunk with appropriate method
 * @param {string} filePath - Path to document
 * @param {string} docId - Document ID
 * @param {object} options - Processing options
 * @returns {Promise<{chunks: Array, metadata: object}>}
 */
async function processDocument(filePath, docId, options = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const isMarkdown = ext === '.md';

  let chunks;
  let metadata;

  if (isMarkdown) {
    // Process Markdown file with header-based chunking
    const extracted = await extractTextFromMarkdown(filePath);
    chunks = chunkByHeaders(extracted.text, options);
    console.log(`Chunked markdown by headers: ${chunks.length} sections`);

    metadata = {
      docId: docId,
      filename: path.basename(filePath),
      numPages: chunks.length, // Use section count as "pages" for markdown
      totalChunks: chunks.length,
      totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
      extractedTextLength: extracted.text.length,
      fileType: 'markdown'
    };

    // Add document metadata to each chunk
    chunks = chunks.map(chunk => ({
      ...chunk,
      docId: docId,
      metadata: {
        source: path.basename(filePath),
        numPages: metadata.numPages,
        fileType: 'markdown',
        header: chunk.header,
        sectionIndex: chunk.sectionIndex
      }
    }));
  } else {
    // Process PDF file with page-based chunking
    const extracted = await extractTextFromPDF(filePath);

    // Use page-based chunking (one chunk per page) for accurate page numbers
    if (extracted.pageTexts && extracted.pageTexts.length > 0) {
      chunks = chunkByPages(extracted.pageTexts, options);
      console.log(`Chunked document by page: ${chunks.length} chunks from ${extracted.numPages} pages`);
    } else {
      // Fallback to regular chunking if page texts not available
      chunks = chunkText(extracted.text, options);
    }

    // Add document metadata to each chunk
    chunks = chunks.map(chunk => ({
      ...chunk,
      docId: docId,
      metadata: {
        source: path.basename(filePath),
        numPages: extracted.numPages,
        pdfInfo: extracted.info,
        fileType: 'pdf'
      }
    }));

    metadata = {
      docId: docId,
      filename: path.basename(filePath),
      numPages: extracted.numPages,
      totalChunks: chunks.length,
      totalTokens: chunks.reduce((sum, c) => sum + c.tokenCount, 0),
      extractedTextLength: extracted.text.length,
      pdfInfo: extracted.info,
      fileType: 'pdf'
    };
  }

  return {
    chunks: chunks,
    metadata: metadata
  };
}

// Directory for stored PDF documents
const DOCS_DIR = path.join(__dirname, '..', 'data', 'documents');

// Ensure documents directory exists
if (!fs.existsSync(DOCS_DIR)) {
  fs.mkdirSync(DOCS_DIR, { recursive: true });
}

/**
 * Keep PDF file for on-demand page rendering
 * @param {string} sourcePath - Original uploaded file path
 * @param {string} docId - Document ID
 * @returns {string} - New file path
 */
function keepPDFFile(sourcePath, docId) {
  const destPath = path.join(DOCS_DIR, `${docId}.pdf`);
  fs.copyFileSync(sourcePath, destPath);
  console.log(`Stored PDF: ${destPath}`);
  return destPath;
}

/**
 * Get stored PDF path
 * @param {string} docId - Document ID
 * @returns {string|null} - File path or null if not found
 */
function getStoredPDFPath(docId) {
  const filePath = path.join(DOCS_DIR, `${docId}.pdf`);
  return fs.existsSync(filePath) ? filePath : null;
}

/**
 * Delete stored PDF file
 * @param {string} docId - Document ID
 */
function deleteStoredPDF(docId) {
  const filePath = path.join(DOCS_DIR, `${docId}.pdf`);
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
    console.log(`Deleted stored PDF: ${filePath}`);
  }
}

/**
 * Render a specific page from a stored PDF as an image using pdftoppm
 * Uses in-memory caching to prevent race conditions and improve performance
 * @param {string} docId - Document ID
 * @param {number} pageNumber - Page number (1-based)
 * @returns {Promise<Buffer>} - PNG image buffer
 */
async function renderPDFPage(docId, pageNumber) {
  const cacheKey = `${docId}_${pageNumber}`;

  // Check cache first
  const cached = renderCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    console.log(`Cache hit for ${cacheKey}`);
    return cached.buffer;
  }

  const pdfPath = getStoredPDFPath(docId);
  if (!pdfPath) {
    throw new Error(`PDF not found for document: ${docId}`);
  }

  // Check for pdftoppm in common locations
  const pdftoppmPaths = [
    'pdftoppm',
    'C:\\poppler\\poppler-25.12.0\\Library\\bin\\pdftoppm.exe',
    'C:\\poppler\\Library\\bin\\pdftoppm.exe',
  ];

  let pdftoppmPath = null;
  for (const p of pdftoppmPaths) {
    try {
      await execFileAsync(p, ['-v']);
      pdftoppmPath = p;
      break;
    } catch (e) {
      // Try next path
    }
  }

  let imageBuffer;

  if (pdftoppmPath) {
    const tempDir = path.join(__dirname, '..', 'data', 'temp');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }
    // Use UUID instead of Date.now() to prevent collisions
    const tempBase = path.join(tempDir, `render_${uuidv4()}`);
    const tempFile = tempBase + '.png';

    try {
      await execFileAsync(pdftoppmPath, [
        '-f', String(pageNumber),
        '-l', String(pageNumber),
        '-png',
        '-r', '150',
        '-singlefile',
        pdfPath,
        tempBase
      ], { maxBuffer: 50 * 1024 * 1024 });

      imageBuffer = fs.readFileSync(tempFile);
      fs.unlinkSync(tempFile);

      imageBuffer = await sharp(imageBuffer)
        .resize(1400, 1800, { fit: 'inside', withoutEnlargement: true })
        .png({ compressionLevel: 6 })
        .toBuffer();
    } catch (err) {
      if (fs.existsSync(tempFile)) {
        fs.unlinkSync(tempFile);
      }
      console.warn('pdftoppm execution failed:', err.message);
      imageBuffer = null; // Fall through to fallback
    }
  }

  // Fallback to pdf-to-img if pdftoppm not available or failed
  if (!imageBuffer) {
    console.log('Using pdf-to-img fallback for page rendering');
    const { pdf } = await import('pdf-to-img');
    const document = await pdf(pdfPath, { scale: 2.0 });

    if (pageNumber < 1 || pageNumber > document.length) {
      throw new Error(`Page ${pageNumber} out of range (1-${document.length})`);
    }

    const pageImage = await document.getPage(pageNumber);

    imageBuffer = await sharp(pageImage)
      .resize(1400, 1800, { fit: 'inside', withoutEnlargement: true })
      .png({ compressionLevel: 6 })
      .toBuffer();
  }

  // Store in cache (evict oldest if full)
  if (renderCache.size >= CACHE_MAX_SIZE) {
    const oldestKey = renderCache.keys().next().value;
    renderCache.delete(oldestKey);
  }
  renderCache.set(cacheKey, { buffer: imageBuffer, timestamp: Date.now() });

  return imageBuffer;
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

/**
 * Extract images from a PDF file by converting pages to images
 * Uses pdf-to-img for reliable page rendering
 * @param {string} filePath - Path to the PDF file
 * @param {string} docId - Document ID for naming images
 * @param {object} options - Extraction options
 * @returns {Promise<Array<{path: string, filename: string, pageNumber: number, index: number, width: number, height: number}>>}
 */
async function extractImagesFromPDF(filePath, docId, options = {}) {
  const maxImages = options.maxImages || 20;
  const extractedImages = [];

  try {
    // Dynamic import for ES module (required for CommonJS compatibility)
    const { pdf } = await import('pdf-to-img');

    // pdf() returns a Promise, await it first to get the document
    const document = await pdf(filePath, { scale: 1.5 });

    console.log(`PDF has ${document.length} pages`);

    let pageNumber = 0;

    // The document is async iterable
    for await (const pageImage of document) {
      pageNumber++;

      if (extractedImages.length >= maxImages) {
        console.log(`Reached max images limit (${maxImages}), stopping extraction`);
        break;
      }

      try {
        const filename = `${docId}_p${pageNumber}_i0.png`;
        const imagePath = path.join(IMAGES_DIR, filename);

        // pageImage is a Buffer containing PNG data
        // Resize/compress using sharp
        await sharp(pageImage)
          .resize(1200, 1600, { fit: 'inside', withoutEnlargement: true })
          .png({ compressionLevel: 8 })
          .toFile(imagePath);

        // Get final dimensions
        const metadata = await sharp(imagePath).metadata();

        extractedImages.push({
          path: imagePath,
          filename: filename,
          pageNumber: pageNumber,
          index: 0,
          width: metadata.width,
          height: metadata.height
        });

        console.log(`Extracted page ${pageNumber} as image: ${filename} (${metadata.width}x${metadata.height})`);

      } catch (pageError) {
        console.warn(`Failed to process page ${pageNumber}:`, pageError.message);
        continue;
      }
    }

    console.log(`Total page images extracted: ${extractedImages.length}`);
    return extractedImages;

  } catch (error) {
    console.error('Error extracting images from PDF:', error);
    return extractedImages; // Return whatever we managed to extract
  }
}

/**
 * Delete all images for a document
 * @param {string} docId - Document ID
 */
function deleteDocumentImages(docId) {
  try {
    const files = fs.readdirSync(IMAGES_DIR);
    const docImages = files.filter(f => f.startsWith(`${docId}_`));

    for (const file of docImages) {
      const filePath = path.join(IMAGES_DIR, file);
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log(`Deleted image: ${file}`);
      }
    }

    console.log(`Deleted ${docImages.length} images for document ${docId}`);
  } catch (error) {
    console.error(`Error deleting images for document ${docId}:`, error);
  }
}

/**
 * Get all images for a document
 * @param {string} docId - Document ID
 * @returns {Array<{filename: string, path: string}>}
 */
function getDocumentImages(docId) {
  try {
    const files = fs.readdirSync(IMAGES_DIR);
    const docImages = files.filter(f => f.startsWith(`${docId}_`));

    return docImages.map(filename => ({
      filename,
      path: path.join(IMAGES_DIR, filename)
    }));
  } catch (error) {
    console.error(`Error getting images for document ${docId}:`, error);
    return [];
  }
}

/**
 * Get the images directory path
 * @returns {string}
 */
function getImagesDirectory() {
  return IMAGES_DIR;
}

module.exports = {
  extractTextFromPDF,
  extractTextFromMarkdown,
  cleanText,
  chunkText,
  chunkTextWithPages,
  chunkByPages,
  chunkByHeaders,
  processDocument,
  deleteFile,
  estimateTokens,
  // PDF storage for on-demand page rendering
  keepPDFFile,
  getStoredPDFPath,
  deleteStoredPDF,
  renderPDFPage,
  // Legacy image functions (kept for cleanup of existing images)
  extractImagesFromPDF,
  deleteDocumentImages,
  getDocumentImages,
  getImagesDirectory
};
