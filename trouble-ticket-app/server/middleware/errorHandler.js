/**
 * Global error handling middleware
 */
function errorHandler(err, req, res, next) {
  console.error('Error:', err);

  // Handle specific error types
  if (err.name === 'ValidationError') {
    return res.status(400).json({
      error: 'Validation Error',
      details: err.message
    });
  }

  if (err.name === 'UnauthorizedError') {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'Invalid or missing authentication'
    });
  }

  // Google Sheets API errors
  if (err.code === 403 && err.message?.includes('Google')) {
    return res.status(503).json({
      error: 'Database Error',
      message: 'Unable to connect to database. Please check configuration.'
    });
  }

  // LLM API errors
  if (err.status === 429) {
    return res.status(429).json({
      error: 'Rate Limited',
      message: 'Too many requests. Please try again in a moment.'
    });
  }

  // Default error response
  const statusCode = err.statusCode || err.status || 500;
  const message = process.env.NODE_ENV === 'production'
    ? 'An unexpected error occurred'
    : err.message || 'Internal server error';

  res.status(statusCode).json({
    error: 'Server Error',
    message,
    ...(process.env.NODE_ENV !== 'production' && { stack: err.stack })
  });
}

module.exports = { errorHandler };
