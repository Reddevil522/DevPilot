const express = require('express');
const rateLimit = require('express-rate-limit');
const { requireAuth } = require('../middleware/auth.middleware');
const { validateRequest } = require('../middleware/validation.middleware');
const {
  validateGenerate,
  validateRevise,
  validateSave,
  validateUpdate,
  validateIdParam,
  validateProjectIdParam,
  validateExport,
} = require('../validators/document.validator');
const documentController = require('../controllers/document.controller');

const router = express.Router();

// Rate limiter for document generation and revision AI calls
const docAiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 60, // 60 requests per window
  message: {
    success: false,
    message: 'Too many document generation requests. Please slow down and try again later.',
    code: 'RATE_LIMIT_EXCEEDED',
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// All document routes require authentication
router.use(requireAuth);

router.get('/types', documentController.getOptions);
router.post('/generate', docAiLimiter, validateGenerate, validateRequest, documentController.generate);
router.post('/revise', docAiLimiter, validateRevise, validateRequest, documentController.revise);
router.post('/save', validateSave, validateRequest, documentController.save);
router.post('/export', validateExport, validateRequest, documentController.exportDirect);

router.get('/project/:projectId', validateProjectIdParam, validateRequest, documentController.getByProject);

router.route('/:id')
  .get(validateIdParam, validateRequest, documentController.getById)
  .put(validateUpdate, validateRequest, documentController.update)
  .delete(validateIdParam, validateRequest, documentController.deleteDoc);

router.get('/:id/export', validateIdParam, validateExport, validateRequest, documentController.exportDoc);

module.exports = router;

