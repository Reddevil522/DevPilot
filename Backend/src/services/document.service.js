const path = require('path');
const Document = require('../models/document.model');
const Project = require('../models/project.model');
const AiService = require('./ai.service');
const FileSystemService = require('./filesystem.service');

const DOC_DEFAULT_PATHS = {
  readme: 'README.md',
  api: 'docs/API.md',
  code: 'docs/CODE_OVERVIEW.md',
  architecture: 'docs/ARCHITECTURE.md',
  deployment: 'docs/DEPLOYMENT.md',
  proposal: 'docs/PROPOSAL.md',
  report: 'docs/REPORT.md',
  meeting_notes: 'docs/MEETING_NOTES.md',
  study_notes: 'docs/STUDY_NOTES.md',
  business: 'docs/BUSINESS_SPEC.md',
  custom: 'docs/DOCUMENTATION.md',
};

const DOC_TYPE_OPTIONS = [
  {
    id: 'readme',
    label: 'README',
    description: 'Project overview, setup instructions, and quickstart guide',
    defaultFileName: 'README.md',
    defaultTitle: 'README.md',
    icon: 'file-text',
    templateHints: 'Project description, prerequisites, installation, usage, scripts, license.',
  },
  {
    id: 'api',
    label: 'API Reference',
    description: 'Complete API endpoint specifications, parameters, and response schemas',
    defaultFileName: 'docs/API.md',
    defaultTitle: 'API Reference',
    icon: 'zap',
    templateHints: 'HTTP methods, route endpoints, request/response bodies, authentication headers.',
  },
  {
    id: 'architecture',
    label: 'Architecture Overview',
    description: 'System design, component relationships, data flow, and layers',
    defaultFileName: 'docs/ARCHITECTURE.md',
    defaultTitle: 'Architecture Overview',
    icon: 'layers',
    templateHints: 'Architecture diagram, component responsibilities, data flow, database models.',
  },
  {
    id: 'code',
    label: 'Code Overview',
    description: 'Codebase directory organization, core services, and key module structures',
    defaultFileName: 'docs/CODE_OVERVIEW.md',
    defaultTitle: 'Code Overview',
    icon: 'code-2',
    templateHints: 'Project layout, modules, state management, shared utilities, coding conventions.',
  },
  {
    id: 'deployment',
    label: 'Deployment Guide',
    description: 'Production build steps, environment variables, and hosting instructions',
    defaultFileName: 'docs/DEPLOYMENT.md',
    defaultTitle: 'Deployment Guide',
    icon: 'rocket',
    templateHints: 'Production requirements, Docker commands, environment configuration, cloud deployment.',
  },
  {
    id: 'proposal',
    label: 'Project Proposal',
    description: 'Project scope, problem statement, technical approach, and milestones',
    defaultFileName: 'docs/PROPOSAL.md',
    defaultTitle: 'Project Proposal',
    icon: 'sparkles',
    templateHints: 'Problem statement, proposed architecture, milestone roadmap, risk analysis.',
  },
  {
    id: 'report',
    label: 'Technical Report',
    description: 'Analytical findings, system evaluation, performance insights, and recommendations',
    defaultFileName: 'docs/REPORT.md',
    defaultTitle: 'Technical Report',
    icon: 'bar-chart-3',
    templateHints: 'Executive summary, methodologies, observations, challenges, strategic recommendations.',
  },
  {
    id: 'meeting_notes',
    label: 'Meeting Notes',
    description: 'Meeting agenda, discussion points, decisions made, and assigned action items',
    defaultFileName: 'docs/MEETING_NOTES.md',
    defaultTitle: 'Meeting Notes',
    icon: 'clock',
    templateHints: 'Attendees, agenda topics, key decisions, action items table with owners and due dates.',
  },
  {
    id: 'study_notes',
    label: 'Study Notes',
    description: 'Conceptual breakdown, core terminology, code examples, and review questions',
    defaultFileName: 'docs/STUDY_NOTES.md',
    defaultTitle: 'Study Notes',
    icon: 'lightbulb',
    templateHints: 'Learning objectives, core terminology, detailed explanations, code snippets, review Q&A.',
  },
  {
    id: 'business',
    label: 'Business Document',
    description: 'Business context, operational workflows, resource allocations, and roadmap',
    defaultFileName: 'docs/BUSINESS_SPEC.md',
    defaultTitle: 'Business Document',
    icon: 'layers',
    templateHints: 'Market need, business requirements, process flow, governance, implementation plan.',
  },
  {
    id: 'custom',
    label: 'Custom Document',
    description: 'Specialized technical documentation generated from your specific instructions',
    defaultFileName: 'docs/DOCUMENTATION.md',
    defaultTitle: 'Technical Documentation',
    icon: 'file',
    templateHints: 'Tailored prompt and instructions based on project needs.',
  },
];

class DocumentService {
  /**
   * Returns list of supported document types with metadata and default options.
   */
  static getSupportedDocTypes() {
    return {
      docTypes: DOC_TYPE_OPTIONS,
      formats: ['markdown', 'text', 'html'],
      defaultModel: process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
    };
  }

  /**
   * Generates a new documentation document using Python AI service + Ollama.
   */
  static async generateDocument({
    project,
    userId,
    docType = 'readme',
    title,
    instructions,
    sourceContent,
    audience,
    tone,
    length,
    includeProjectContext = true,
    targetPath,
    saveToHistory = true,
    model,
  }) {
    if (!project) {
      const err = new Error('Project context is required to generate documentation.');
      err.status = 400;
      throw err;
    }

    if (project.ownerId.toString() !== userId) {
      const err = new Error('You do not have access to this project.');
      err.status = 403;
      throw err;
    }

    const resolvedTitle = (title && title.trim()) ||
      (docType === 'readme' ? 'README.md' : `${docType.charAt(0).toUpperCase() + docType.slice(1)} Documentation`);

    let resolvedPath = targetPath ? targetPath.trim() : (DOC_DEFAULT_PATHS[docType] || 'README.md');
    if (resolvedPath) {
      const pathError = FileSystemService.validateRelativePath(resolvedPath);
      if (pathError) {
        const err = new Error(`Invalid targetPath: ${pathError}`);
        err.status = 400;
        throw err;
      }
    }

    const startTime = Date.now();

    const aiResult = await AiService.generateDocumentation({
      project,
      docType,
      title: resolvedTitle,
      instructions,
      sourceContent,
      audience,
      tone,
      length,
      includeProjectContext,
      model,
    });

    const generationTimeMs = Date.now() - startTime;
    const wordCount = (aiResult.content || '').split(/\s+/).filter(Boolean).length;

    let savedDocument = null;
    if (saveToHistory) {
      savedDocument = await Document.create({
        projectId: project._id,
        userId,
        title: resolvedTitle,
        docType,
        filePath: resolvedPath,
        content: aiResult.content,
        format: 'markdown',
        status: 'completed',
        version: 1,
        metadata: {
          model: aiResult.model || model || process.env.OLLAMA_MODEL || 'qwen2.5-coder:3b',
          instructions: instructions || '',
          sourceContent: sourceContent ? `${sourceContent.slice(0, 500)}...` : '',
          generationTimeMs,
          wordCount,
          proposal: aiResult.proposal || null,
        },
      });
    }

    return {
      docType: aiResult.docType,
      title: resolvedTitle,
      filePath: resolvedPath,
      content: aiResult.content,
      proposal: aiResult.proposal,
      model: aiResult.model,
      documentId: savedDocument ? savedDocument._id.toString() : null,
      createdAt: savedDocument ? savedDocument.createdAt : new Date(),
      generationTimeMs,
      wordCount,
    };
  }

  /**
   * Revises an existing document using revision instructions.
   */
  static async reviseDocument({
    project,
    userId,
    documentId,
    currentContent,
    revisionInstruction,
    docType,
    title,
    model,
  }) {
    let existingDoc = null;
    let targetProject = project;

    if (documentId) {
      existingDoc = await Document.findById(documentId);
      if (!existingDoc) {
        const err = new Error('Document not found.');
        err.status = 404;
        throw err;
      }
      if (existingDoc.userId.toString() !== userId) {
        const err = new Error('You do not have access to this document.');
        err.status = 403;
        throw err;
      }
      if (!targetProject) {
        targetProject = await Project.findById(existingDoc.projectId);
      }
    }

    if (!targetProject) {
      const err = new Error('Project context is required to revise documentation.');
      err.status = 400;
      throw err;
    }

    if (targetProject.ownerId.toString() !== userId) {
      const err = new Error('You do not have access to this project.');
      err.status = 403;
      throw err;
    }

    const resolvedDocType = docType || (existingDoc ? existingDoc.docType : 'readme');
    const resolvedTitle = title || (existingDoc ? existingDoc.title : 'README.md');

    const aiResult = await AiService.generateDocumentation({
      project: targetProject,
      docType: resolvedDocType,
      title: resolvedTitle,
      currentContent,
      revisionInstruction,
      model,
    });

    let version = 1;
    if (existingDoc) {
      existingDoc.content = aiResult.content;
      existingDoc.version += 1;
      existingDoc.metadata = {
        ...(existingDoc.metadata || {}),
        model: aiResult.model || existingDoc.metadata?.model,
        instructions: revisionInstruction,
      };
      await existingDoc.save();
      version = existingDoc.version;
    }

    return {
      docType: aiResult.docType,
      title: resolvedTitle,
      content: aiResult.content,
      proposal: aiResult.proposal,
      model: aiResult.model,
      documentId: existingDoc ? existingDoc._id.toString() : null,
      version,
      updatedAt: existingDoc ? existingDoc.updatedAt : new Date(),
    };
  }

  /**
   * Saves or updates a document record, and optionally writes it to the local project disk.
   */
  static async saveDocument({
    project,
    userId,
    documentId,
    title,
    docType,
    content,
    filePath,
    format = 'markdown',
    saveToProject = false,
  }) {
    if (!project) {
      const err = new Error('Project not found.');
      err.status = 404;
      throw err;
    }
    if (project.ownerId.toString() !== userId) {
      const err = new Error('You do not have access to this project.');
      err.status = 403;
      throw err;
    }

    const cleanFilePath = filePath ? filePath.trim() : (DOC_DEFAULT_PATHS[docType] || 'README.md');
    if (cleanFilePath) {
      const pathError = FileSystemService.validateRelativePath(cleanFilePath);
      if (pathError) {
        const err = new Error(`Invalid filePath: ${pathError}`);
        err.status = 400;
        throw err;
      }
    }

    // Optionally write directly to the local project workspace on disk
    let fileWrittenToDisk = false;
    if (saveToProject) {
      if (project.projectType !== 'local' || !project.localPath) {
        const err = new Error('Only local projects support direct filesystem writes.');
        err.status = 400;
        throw err;
      }
      await FileSystemService.writeFile(project.localPath, cleanFilePath, content || '');
      fileWrittenToDisk = true;
    }

    let document = null;
    if (documentId) {
      document = await Document.findById(documentId);
      if (!document) {
        const err = new Error('Document not found.');
        err.status = 404;
        throw err;
      }
      if (document.userId.toString() !== userId) {
        const err = new Error('You do not have access to this document.');
        err.status = 403;
        throw err;
      }

      document.title = title || document.title;
      document.docType = docType || document.docType;
      document.content = content !== undefined ? content : document.content;
      document.filePath = cleanFilePath;
      document.format = format || document.format;
      document.status = 'completed';
      document.version += 1;
      await document.save();
    } else {
      document = await Document.create({
        projectId: project._id,
        userId,
        title,
        docType,
        filePath: cleanFilePath,
        content: content || '',
        format: format || 'markdown',
        status: 'completed',
        version: 1,
      });
    }

    return {
      document,
      fileWrittenToDisk,
      filePath: cleanFilePath,
    };
  }

  /**
   * Retrieves document history for a project.
   */
  static async getProjectDocuments(projectId, userId) {
    const project = await Project.findById(projectId);
    if (!project) {
      const err = new Error('Project not found.');
      err.status = 404;
      throw err;
    }
    if (project.ownerId.toString() !== userId) {
      const err = new Error('You do not have access to this project.');
      err.status = 403;
      throw err;
    }

    return Document.find({ projectId, userId }).sort({ updatedAt: -1 });
  }

  /**
   * Retrieves a single document by ID with ownership verification.
   */
  static async getDocumentById(documentId, userId) {
    const doc = await Document.findById(documentId);
    if (!doc) {
      const err = new Error('Document not found.');
      err.status = 404;
      throw err;
    }
    if (doc.userId.toString() !== userId) {
      const err = new Error('You do not have access to this document.');
      err.status = 403;
      throw err;
    }
    return doc;
  }

  /**
   * Updates an existing document's content/metadata with ownership verification.
   */
  static async updateDocument(documentId, userId, updates) {
    const doc = await this.getDocumentById(documentId, userId);

    if (updates.title) doc.title = updates.title.trim();
    if (updates.content !== undefined) doc.content = updates.content;
    if (updates.filePath) {
      const pathError = FileSystemService.validateRelativePath(updates.filePath);
      if (pathError) {
        const err = new Error(`Invalid filePath: ${pathError}`);
        err.status = 400;
        throw err;
      }
      doc.filePath = updates.filePath.trim();
    }
    if (updates.format) doc.format = updates.format;
    if (updates.status) doc.status = updates.status;

    doc.version += 1;
    await doc.save();
    return doc;
  }

  /**
   * Deletes a document by ID with ownership verification.
   */
  static async deleteDocument(documentId, userId) {
    const doc = await this.getDocumentById(documentId, userId);
    await Document.deleteOne({ _id: doc._id });
    return { success: true, message: 'Document deleted successfully.' };
  }

  /**
   * Formats content for download/export (Markdown, Text, HTML).
   */
  static exportDocument({ title, content, format = 'markdown' }) {
    const safeTitle = (title || 'document')
      .replace(/[^\w\s.-]/g, '')
      .trim()
      .replace(/\s+/g, '_') || 'document';

    let fileContent = content || '';
    let mimeType = 'text/markdown; charset=utf-8';
    let fileExtension = 'md';

    if (format === 'text') {
      mimeType = 'text/plain; charset=utf-8';
      fileExtension = 'txt';
      // Strip markdown headers/formatting for plain text view
      fileContent = fileContent
        .replace(/^#+\s+/gm, '')
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/`([^`]+)`/g, '$1');
    } else if (format === 'html') {
      mimeType = 'text/html; charset=utf-8';
      fileExtension = 'html';
      // Wrap formatted markdown in clean HTML document template
      fileContent = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title || 'DevPilot Documentation')}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; color: #1e293b; max-width: 860px; margin: 40px auto; padding: 0 20px; }
    h1, h2, h3, h4 { color: #0f172a; margin-top: 1.5em; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; font-family: Consolas, monospace; }
    pre { background: #0f172a; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; }
    pre code { background: none; color: inherit; padding: 0; }
    blockquote { border-left: 4px solid #6366f1; margin: 0; padding-left: 16px; color: #475569; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #e2e8f0; padding: 8px 12px; text-align: left; }
    th { background: #f8fafc; }
  </style>
</head>
<body>
  <pre>${escapeHtml(content || '')}</pre>
</body>
</html>`;
    }

    const fileName = `${safeTitle}.${fileExtension}`;
    return {
      fileName,
      mimeType,
      fileContent,
    };
  }
}

function escapeHtml(str) {
  return (str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

module.exports = DocumentService;

