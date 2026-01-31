require('dotenv').config();

const express = require('express');
const cors = require('cors');
const { errorHandler } = require('./middleware/errorHandler');
const { sanitizeInput } = require('./middleware/sanitize');

// Import routes
const chatRoutes = require('./routes/chat');
const ticketRoutes = require('./routes/tickets');
const settingsRoutes = require('./routes/settings');
const knowledgeRoutes = require('./routes/knowledge');
const healthRoutes = require('./routes/health');
const documentsRoutes = require('./routes/documents');

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(sanitizeInput);

// Routes
app.use('/api/chat', chatRoutes);
app.use('/api/tickets', ticketRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/health', healthRoutes);
app.use('/api/documents', documentsRoutes);

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
  console.log(`Health check: http://localhost:${PORT}/api/health`);
});

module.exports = app;
