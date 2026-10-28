const express = require('express');
const rateLimit = require('express-rate-limit');
const {
  chat,
  chatStream,
  getConversations,
  getConversation,
  clearConversation,
  applyChanges,
  rejectChanges,
  generateDocs
} = require('../controllers/ai.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const documentRoutes = require('./document.routes');

const router = express.Router();

// Rate limiter for AI chat requests
const aiChatLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 requests per window
  message: {
    success: false,
    message: 'Too many AI requests. Please slow down and try again later.',
    code: 'RATE_LIMIT_EXCEEDED'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// All AI routes require authentication
router.use(requireAuth);

// Sub-routes for Document Generation & Management
router.use('/docs', documentRoutes);

router.post('/chat', aiChatLimiter, chat);
router.post('/chat/stream', aiChatLimiter, chatStream);
router.post('/generate-docs', aiChatLimiter, generateDocs);
router.get('/conversations', getConversations);
router.get('/conversations/:id', getConversation);
router.delete('/conversations/:id', clearConversation);

router.post('/apply-changes', applyChanges);
router.post('/reject-changes', rejectChanges);

module.exports = router;
