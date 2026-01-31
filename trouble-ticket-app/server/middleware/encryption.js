/**
 * Encryption utilities for sensitive data (API keys)
 * Uses AES-256-CBC encryption
 */
const crypto = require('crypto');

// SECURITY: Require encryption key from environment - no fallback
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 32) {
  console.error('ENCRYPTION_KEY environment variable must be exactly 32 characters');
  console.error('Generate one with: node -e "console.log(require(\'crypto\').randomBytes(16).toString(\'hex\'))"');
  process.exit(1);
}

const IV_LENGTH = 16;

/**
 * Encrypt a string using AES-256-CBC
 * @param {string} text - The plaintext to encrypt
 * @returns {string} - The encrypted string in format: iv:encrypted
 */
function encrypt(text) {
  if (!text) return '';

  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
  let encrypted = cipher.update(text);
  encrypted = Buffer.concat([encrypted, cipher.final()]);

  return iv.toString('hex') + ':' + encrypted.toString('hex');
}

/**
 * Decrypt a string that was encrypted with encrypt()
 * @param {string} text - The encrypted string in format: iv:encrypted
 * @returns {string} - The decrypted plaintext
 */
function decrypt(text) {
  if (!text) return '';

  try {
    const parts = text.split(':');
    const iv = Buffer.from(parts.shift(), 'hex');
    const encryptedText = Buffer.from(parts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);

    return decrypted.toString();
  } catch (error) {
    console.error('Decryption error:', error.message);
    return '';
  }
}

module.exports = { encrypt, decrypt };
