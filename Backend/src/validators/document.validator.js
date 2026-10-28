const { body, param, query } = require('express-validator');
const FileSystemService = require('../services/filesystem.service');

const SUPPORTED_DOC_TYPES = [
  'readme',
  'api',
  'code',
  'architecture',
  'deployment',
  'proposal',
  'report',
  'meeting_notes',
  'study_notes',
  'business',
  'custom',
];
const SUPPORTED_FORMATS = ['markdown', 'text', 'html'];
const SUPPORTED_STATUSES = ['draft', 'generating', 'completed', 'failed', 'archived'];

const validateDocPath = (value) => {
  if (!value) return true;
  const error = FileSystemService.validateRelativePath(value);
  if (error) {
    throw new Error(error);
  }
  return true;
};

const validateGenerate = [
  body('projectId')
    .notEmpty()
    .withMessage('projectId is required')
    .isMongoId()
    .withMessage('Invalid projectId format'),
  body('docType')
    .optional()
    .isIn(SUPPORTED_DOC_TYPES)
    .withMessage(`docType must be one of: ${SUPPORTED_DOC_TYPES.join(', ')}`),
  body('title')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
  body('instructions')
    .optional()
    .isString()
    .isLength({ max: 10000 })
    .withMessage('Instructions cannot exceed 10,000 characters'),
  body('sourceContent')
    .optional()
    .isString()
    .isLength({ max: 50000 })
    .withMessage('Source content cannot exceed 50,000 characters'),
  body('audience')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Audience cannot exceed 100 characters'),
  body('tone')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Tone cannot exceed 100 characters'),
  body('length')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 50 })
    .withMessage('Length cannot exceed 50 characters'),
  body('includeProjectContext')
    .optional()
    .isBoolean()
    .withMessage('includeProjectContext must be a boolean'),
  body('targetPath')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Target path cannot exceed 500 characters')
    .custom(validateDocPath),
  body('saveToHistory')
    .optional()
    .isBoolean()
    .withMessage('saveToHistory must be a boolean'),
];

const validateRevise = [
  body('currentContent')
    .notEmpty()
    .withMessage('currentContent is required')
    .isString()
    .isLength({ max: 100000 })
    .withMessage('Current content cannot exceed 100,000 characters'),
  body('revisionInstruction')
    .notEmpty()
    .withMessage('revisionInstruction is required')
    .isString()
    .trim()
    .isLength({ max: 10000 })
    .withMessage('Revision instruction cannot exceed 10,000 characters'),
  body('documentId')
    .optional()
    .isMongoId()
    .withMessage('Invalid documentId format'),
  body('projectId')
    .optional()
    .isMongoId()
    .withMessage('Invalid projectId format'),
  body('docType')
    .optional()
    .isIn(SUPPORTED_DOC_TYPES)
    .withMessage(`docType must be one of: ${SUPPORTED_DOC_TYPES.join(', ')}`),
  body('title')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 200 })
    .withMessage('Title cannot exceed 200 characters'),
];

const validateSave = [
  body('projectId')
    .notEmpty()
    .withMessage('projectId is required')
    .isMongoId()
    .withMessage('Invalid projectId format'),
  body('title')
    .notEmpty()
    .withMessage('Title is required')
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('docType')
    .notEmpty()
    .withMessage('docType is required')
    .isIn(SUPPORTED_DOC_TYPES)
    .withMessage(`docType must be one of: ${SUPPORTED_DOC_TYPES.join(', ')}`),
  body('content')
    .optional()
    .isString()
    .isLength({ max: 100000 })
    .withMessage('Content cannot exceed 100,000 characters'),
  body('filePath')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('File path cannot exceed 500 characters')
    .custom(validateDocPath),
  body('format')
    .optional()
    .isIn(SUPPORTED_FORMATS)
    .withMessage(`Format must be one of: ${SUPPORTED_FORMATS.join(', ')}`),
  body('saveToProject')
    .optional()
    .isBoolean()
    .withMessage('saveToProject must be a boolean'),
];

const validateUpdate = [
  param('id')
    .isMongoId()
    .withMessage('Invalid document ID parameter'),
  body('title')
    .optional()
    .isString()
    .trim()
    .isLength({ min: 1, max: 200 })
    .withMessage('Title must be between 1 and 200 characters'),
  body('content')
    .optional()
    .isString()
    .isLength({ max: 100000 })
    .withMessage('Content cannot exceed 100,000 characters'),
  body('filePath')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 500 })
    .withMessage('File path cannot exceed 500 characters')
    .custom(validateDocPath),
  body('format')
    .optional()
    .isIn(SUPPORTED_FORMATS)
    .withMessage(`Format must be one of: ${SUPPORTED_FORMATS.join(', ')}`),
  body('status')
    .optional()
    .isIn(SUPPORTED_STATUSES)
    .withMessage(`Status must be one of: ${SUPPORTED_STATUSES.join(', ')}`),
];

const validateIdParam = [
  param('id')
    .isMongoId()
    .withMessage('Invalid document ID parameter'),
];

const validateProjectIdParam = [
  param('projectId')
    .isMongoId()
    .withMessage('Invalid projectId parameter'),
];

const validateExport = [
  query('format')
    .optional()
    .isIn(SUPPORTED_FORMATS)
    .withMessage(`Format must be one of: ${SUPPORTED_FORMATS.join(', ')}`),
  body('format')
    .optional()
    .isIn(SUPPORTED_FORMATS)
    .withMessage(`Format must be one of: ${SUPPORTED_FORMATS.join(', ')}`),
];

module.exports = {
  SUPPORTED_DOC_TYPES,
  SUPPORTED_FORMATS,
  SUPPORTED_STATUSES,
  validateGenerate,
  validateRevise,
  validateSave,
  validateUpdate,
  validateIdParam,
  validateProjectIdParam,
  validateExport,
};

