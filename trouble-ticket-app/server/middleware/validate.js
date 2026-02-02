/**
 * Request validation middleware using express-validator
 */
const { body, param, query, validationResult } = require('express-validator');

/**
 * Middleware to check validation results and return errors
 */
const validateRequest = (req, res, next) => {
  const errors = validationResult(req);
  if (!errors.isEmpty()) {
    return res.status(400).json({
      error: 'Validation Error',
      details: errors.array().map(e => ({
        field: e.path,
        message: e.msg
      }))
    });
  }
  next();
};

// Chat message validation rules
const chatMessageRules = [
  body('sessionId')
    .isString()
    .notEmpty()
    .withMessage('Session ID is required')
    .isLength({ max: 100 })
    .withMessage('Session ID must be less than 100 characters'),
  body('message')
    .isString()
    .trim()
    .isLength({ min: 1, max: 5000 })
    .withMessage('Message must be between 1 and 5000 characters')
];

// Ticket update validation rules
const ticketUpdateRules = [
  param('id')
    .matches(/^TKT-\d{5}$/)
    .withMessage('Invalid ticket ID format'),
  body('status')
    .optional()
    .isIn(['open', 'waiting_clarification', 'waiting_confirmation', 'closed'])
    .withMessage('Invalid status value'),
  body('it_notes')
    .optional()
    .isString()
    .isLength({ max: 2000 })
    .withMessage('IT notes must be less than 2000 characters')
];

// Clarification request validation rules
const clarificationRules = [
  param('id')
    .matches(/^TKT-\d{5}$/)
    .withMessage('Invalid ticket ID format'),
  body('question')
    .isString()
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Question must be between 1 and 1000 characters')
];

// Settings update validation rules
const settingsRules = [
  body('provider')
    .optional()
    .isIn(['anthropic', 'openai', 'openrouter', 'custom'])
    .withMessage('Invalid API provider'),
  body('apiKey')
    .optional()
    .isString()
    .isLength({ min: 10, max: 200 })
    .withMessage('API key must be between 10 and 200 characters'),
  body('model')
    .optional()
    .isString()
    .isLength({ max: 100 })
    .withMessage('Model name must be less than 100 characters'),
  body('baseUrl')
    .optional({ values: 'falsy' })
    .isURL()
    .withMessage('Base URL must be a valid URL')
];

// Knowledge base document validation rules
const knowledgeDocRules = [
  body('application')
    .isString()
    .trim()
    .notEmpty()
    .withMessage('Application name is required'),
  body('title')
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('content')
    .isString()
    .trim()
    .isLength({ min: 1, max: 50000 })
    .withMessage('Content must be between 1 and 50000 characters'),
  body('keywords')
    .optional()
    .isString()
    .isLength({ max: 500 })
    .withMessage('Keywords must be less than 500 characters')
];

// Session ID validation
const sessionIdRules = [
  param('sessionId')
    .isString()
    .notEmpty()
    .isLength({ max: 100 })
    .withMessage('Invalid session ID')
];

module.exports = {
  validateRequest,
  chatMessageRules,
  ticketUpdateRules,
  clarificationRules,
  settingsRules,
  knowledgeDocRules,
  sessionIdRules
};
