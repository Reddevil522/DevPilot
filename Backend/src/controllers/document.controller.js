const Project = require('../models/project.model');
const DocumentService = require('../services/document.service');

// @desc    Get supported document types and generation options
// @route   GET /api/ai/docs/types
// @access  Private
exports.getOptions = async (req, res, next) => {
  try {
    const options = DocumentService.getSupportedDocTypes();
    res.status(200).json({
      success: true,
      data: options,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Generate documentation using Python AI service + Ollama
// @route   POST /api/ai/docs/generate or POST /api/ai/generate-docs
// @access  Private
exports.generate = async (req, res, next) => {
  try {
    const {
      projectId,
      docType = 'readme',
      title,
      instructions,
      sourceContent,
      audience,
      tone,
      length,
      includeProjectContext,
      targetPath,
      saveToHistory = true,
      model,
    } = req.body;

    const userId = req.user.id || req.user._id?.toString();

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    if (project.ownerId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied to this project.' });
    }

    const result = await DocumentService.generateDocument({
      project,
      userId,
      docType,
      title,
      instructions,
      sourceContent,
      audience,
      tone,
      length,
      includeProjectContext,
      targetPath,
      saveToHistory,
      model,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Revise an existing document with user revision instructions
// @route   POST /api/ai/docs/revise
// @access  Private
exports.revise = async (req, res, next) => {
  try {
    const {
      projectId,
      documentId,
      currentContent,
      revisionInstruction,
      docType,
      title,
      model,
    } = req.body;

    const userId = req.user.id || req.user._id?.toString();

    let project = null;
    if (projectId) {
      project = await Project.findById(projectId);
      if (!project) {
        return res.status(404).json({ success: false, message: 'Project not found.' });
      }
      if (project.ownerId.toString() !== userId) {
        return res.status(403).json({ success: false, message: 'Access denied to this project.' });
      }
    }

    const result = await DocumentService.reviseDocument({
      project,
      userId,
      documentId,
      currentContent,
      revisionInstruction,
      docType,
      title,
      model,
    });

    res.status(200).json({
      success: true,
      data: result,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Save document metadata and content, optionally write to local workspace disk
// @route   POST /api/ai/docs/save
// @access  Private
exports.save = async (req, res, next) => {
  try {
    const {
      projectId,
      documentId,
      title,
      docType = 'readme',
      content,
      filePath,
      format = 'markdown',
      saveToProject = false,
    } = req.body;

    const userId = req.user.id || req.user._id?.toString();

    const project = await Project.findById(projectId);
    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found.' });
    }
    if (project.ownerId.toString() !== userId) {
      return res.status(403).json({ success: false, message: 'Access denied to this project.' });
    }

    const result = await DocumentService.saveDocument({
      project,
      userId,
      documentId,
      title,
      docType,
      content,
      filePath,
      format,
      saveToProject,
    });

    res.status(documentId ? 200 : 201).json({
      success: true,
      data: result.document,
      fileWrittenToDisk: result.fileWrittenToDisk,
      filePath: result.filePath,
      message: result.fileWrittenToDisk
        ? `Document saved and written to disk at ${result.filePath}`
        : 'Document saved successfully.',
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get document history for a project
// @route   GET /api/ai/docs/project/:projectId
// @access  Private
exports.getByProject = async (req, res, next) => {
  try {
    const { projectId } = req.params;
    const userId = req.user.id || req.user._id?.toString();

    const documents = await DocumentService.getProjectDocuments(projectId, userId);
    res.status(200).json({
      success: true,
      data: documents,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get a single document by ID
// @route   GET /api/ai/docs/:id
// @access  Private
exports.getById = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id?.toString();

    const document = await DocumentService.getDocumentById(id, userId);
    res.status(200).json({
      success: true,
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update document content or metadata
// @route   PUT /api/ai/docs/:id
// @access  Private
exports.update = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id?.toString();

    const document = await DocumentService.updateDocument(id, userId, req.body);
    res.status(200).json({
      success: true,
      data: document,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete a document
// @route   DELETE /api/ai/docs/:id
// @access  Private
exports.deleteDoc = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id?.toString();

    const result = await DocumentService.deleteDocument(id, userId);
    res.status(200).json({
      success: true,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Export a saved document by ID
// @route   GET /api/ai/docs/:id/export
// @access  Private
exports.exportDoc = async (req, res, next) => {
  try {
    const { id } = req.params;
    const userId = req.user.id || req.user._id?.toString();
    const format = req.query.format || 'markdown';

    const document = await DocumentService.getDocumentById(id, userId);
    const exportResult = DocumentService.exportDocument({
      title: document.title,
      content: document.content,
      format,
    });

    res.setHeader('Content-Type', exportResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.fileName}"`);
    res.status(200).send(exportResult.fileContent);
  } catch (error) {
    next(error);
  }
};

// @desc    Export document content directly on-the-fly
// @route   POST /api/ai/docs/export
// @access  Private
exports.exportDirect = async (req, res, next) => {
  try {
    const { title, content, format = 'markdown' } = req.body;
    const exportResult = DocumentService.exportDocument({
      title: title || 'document',
      content: content || '',
      format,
    });

    res.setHeader('Content-Type', exportResult.mimeType);
    res.setHeader('Content-Disposition', `attachment; filename="${exportResult.fileName}"`);
    res.status(200).send(exportResult.fileContent);
  } catch (error) {
    next(error);
  }
};

