/**
 * Simple role-based authentication middleware
 * Uses Basic Auth with password hashes stored in Google Sheets settings
 */
const crypto = require('crypto');

// Lazy-load googleSheets to avoid circular dependency
let googleSheets = null;
function getGoogleSheets() {
  if (!googleSheets) {
    googleSheets = require('../services/googleSheets');
  }
  return googleSheets;
}

/**
 * Hash a password using SHA-256
 * @param {string} password - The plaintext password
 * @returns {string} - The hashed password
 */
function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

/**
 * Middleware factory to require a specific role
 * @param {string} role - The required role ('it_support' or 'admin')
 * @returns {Function} - Express middleware
 */
function requireRole(role) {
  return async (req, res, next) => {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Basic ')) {
      return res.status(401).json({
        error: 'Authentication required',
        message: 'Please provide valid credentials'
      });
    }

    try {
      // Decode Basic Auth credentials
      const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
      const colonIndex = credentials.indexOf(':');

      if (colonIndex === -1) {
        return res.status(401).json({
          error: 'Invalid credentials format'
        });
      }

      const providedRole = credentials.substring(0, colonIndex);
      const password = credentials.substring(colonIndex + 1);

      // Check if provided role matches required role or is admin (admin can access everything)
      if (providedRole !== role && providedRole !== 'admin') {
        return res.status(403).json({
          error: 'Access denied',
          message: `This endpoint requires ${role} role`
        });
      }

      // Get stored password hash from settings
      const sheets = getGoogleSheets();
      const storedHash = await sheets.getSetting(`${providedRole}_password_hash`);

      if (!storedHash) {
        console.error(`No password hash found for role: ${providedRole}`);
        return res.status(500).json({
          error: 'Configuration error',
          message: 'Authentication not configured. Please set up password hashes in settings.'
        });
      }

      // Verify password
      if (hashPassword(password) !== storedHash) {
        return res.status(403).json({
          error: 'Access denied',
          message: 'Invalid password'
        });
      }

      // Add role to request for downstream use
      req.userRole = providedRole;
      next();
    } catch (error) {
      console.error('Auth middleware error:', error);
      return res.status(500).json({
        error: 'Authentication error',
        message: 'Unable to verify credentials'
      });
    }
  };
}

/**
 * Optional auth middleware - doesn't require auth but attaches role if provided
 */
function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Basic ')) {
    req.userRole = null;
    return next();
  }

  try {
    const credentials = Buffer.from(authHeader.slice(6), 'base64').toString();
    const colonIndex = credentials.indexOf(':');
    if (colonIndex !== -1) {
      req.userRole = credentials.substring(0, colonIndex);
    }
  } catch {
    req.userRole = null;
  }

  next();
}

module.exports = { requireRole, optionalAuth, hashPassword };
