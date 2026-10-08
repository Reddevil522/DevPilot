const Project = require('../models/project.model');
const mongoose = require('mongoose');
const ProjectGeneratorService = require('../services/project-generator.service');
const path = require('path');
const fs = require('fs').promises;
const { generateUniqueSlug } = require('../utils/slug.util');

async function buildFileTree(dirPath, relativePath = '') {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const nodes = [];

  for (const entry of entries) {
    if (entry.name === '.git' || entry.name === 'node_modules' || entry.name === '.devpilot') continue;

    const fullPath = path.join(dirPath, entry.name);
    const nodeRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;
    
    if (entry.isDirectory()) {
      const children = await buildFileTree(fullPath, nodeRelPath);
      nodes.push({
        name: entry.name,
        type: 'folder',
        path: nodeRelPath,
        isOpen: false,
        children
      });
    } else {
      nodes.push({
        name: entry.name,
        type: 'file',
        path: nodeRelPath,
        extension: path.extname(entry.name).slice(1) || 'txt'
      });
    }
  }
  
  nodes.sort((a, b) => {
    if (a.type === 'folder' && b.type === 'file') return -1;
    if (a.type === 'file' && b.type === 'folder') return 1;
    return a.name.localeCompare(b.name);
  });

  return nodes;
}

// @desc    Create new project
// @route   POST /api/projects
// @access  Private
exports.createProject = async (req, res, next) => {
  try {
    const { name, description, technology, template, projectType, localPath } = req.body;

    if (projectType === 'local' && !localPath) {
      return res.status(400).json({ success: false, message: 'Local path is required for local projects' });
    }

    const projectId = new mongoose.Types.ObjectId();
    const projectDir = path.join(localPath || '', name);

    const generator = new ProjectGeneratorService();
    if (projectType === 'local') {
      await generator.generate(projectDir, name, template, description, projectId.toString(), technology, projectType);
    }

    const slug = await generateUniqueSlug(name, req.user.id);

    const project = await Project.create({
      _id: projectId,
      name,
      slug,
      description,
      technology,
      template,
      projectType,
      localPath: projectType === 'local' ? projectDir : undefined,
      ownerId: req.user.id,
      status: 'active',
      syncStatus: 'LOCAL_ONLY',
      language: technology === 'angular' ? 'TypeScript' : 'JavaScript',
    });

    res.status(201).json({
      success: true,
      data: project,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'A project with this name already exists. Please choose another name.'
      });
    }
    next(error);
  }
};

// @desc    Create new project with SSE stream for progress
// @route   POST /api/projects/stream
// @access  Private
exports.createProjectStream = async (req, res, next) => {
  // Setup SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const { name, description, technology, template, projectType, localPath } = req.body;

    if (projectType === 'local' && !localPath) {
      sendEvent({ type: 'error', message: 'Local path is required for local projects' });
      return res.end();
    }

    const generator = new ProjectGeneratorService((message) => {
      sendEvent({ type: 'progress', message });
    });

    const projectDir = path.join(localPath || '', name);
    const projectId = new mongoose.Types.ObjectId();

    sendEvent({ type: 'progress', message: 'Starting project generation...' });

    if (projectType === 'local') {
      await generator.generate(projectDir, name, template, description, projectId.toString(), technology, projectType);
    }

    sendEvent({ type: 'progress', message: 'Project files generated successfully.' });
    sendEvent({ type: 'progress', message: 'Run npm install inside frontend and backend to install dependencies.' });

    const slug = await generateUniqueSlug(name, req.user.id);

    const project = await Project.create({
      _id: projectId,
      name,
      slug,
      description,
      technology,
      template,
      projectType,
      localPath: projectType === 'local' ? projectDir : undefined,
      ownerId: req.user.id,
      status: 'active',
      syncStatus: 'LOCAL_ONLY',
      language: technology === 'angular' ? 'TypeScript' : 'JavaScript',
    });

    sendEvent({ type: 'complete', project });
    res.end();

  } catch (error) {
    let errorMessage = error.message || 'Generation failed';
    if (error.code === 11000) {
      errorMessage = 'A project with this name already exists. Please choose another name.';
    }
    sendEvent({ type: 'error', message: errorMessage });
    res.end();
  }
};

// @desc    Get all projects for authenticated user
// @route   GET /api/projects
// @access  Private
exports.getProjects = async (req, res, next) => {
  try {
    const projects = await Project.find({ ownerId: req.user.id }).sort('-updatedAt');

    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single project
// @route   GET /api/projects/:id
// @access  Private
exports.getProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Ensure user is project owner
    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this project' });
    }

    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get project files tree
// @route   GET /api/projects/:id/files
// @access  Private
exports.getProjectFiles = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this project' });
    }

    if (project.projectType !== 'local' || !project.localPath) {
      return res.status(400).json({ success: false, message: 'File browsing is only supported for local projects currently' });
    }

    try {
      const fileTree = await buildFileTree(project.localPath);
      res.status(200).json({ success: true, data: fileTree });
    } catch (err) {
      console.error('Failed to read project directory:', err);
      res.status(500).json({ success: false, message: 'Failed to read project directory' });
    }
  } catch (error) {
    next(error);
  }
};

// @desc    Update project
// @route   PATCH /api/projects/:id
// @access  Private
exports.updateProject = async (req, res, next) => {
  try {
    let project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Ensure user is project owner
    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this project' });
    }

    // Only allow updating specific fields
    const { name, description, status } = req.body;
    const updateFields = {};
    if (name) updateFields.name = name;
    if (description !== undefined) updateFields.description = description;
    if (status) updateFields.status = status;

    project = await Project.findByIdAndUpdate(req.params.id, updateFields, {
      new: true,
      runValidators: true,
    });

    res.status(200).json({
      success: true,
      data: project,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Delete project
// @route   DELETE /api/projects/:id
// @access  Private
exports.deleteProject = async (req, res, next) => {
  try {
    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Ensure user is project owner
    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this project' });
    }

    if (project.projectType === 'local' && project.localPath) {
      const identityPath = path.join(project.localPath, '.devpilot', 'project.json');
      try {
        const identityContent = await fs.readFile(identityPath, 'utf8');
        const identity = JSON.parse(identityContent);
        
        if (identity.projectId !== project.id) {
          return res.status(400).json({ 
            success: false, 
            message: 'Project identity mismatch. Aborting physical deletion for safety.' 
          });
        }
        
        // Physically delete the directory recursively
        await fs.rm(project.localPath, { recursive: true, force: true });
      } catch (err) {
        if (err.code === 'ENOENT') {
           console.warn(`Local project path ${project.localPath} or identity not found. Proceeding with metadata deletion.`);
        } else {
           throw err; 
        }
      }
    }

    await project.deleteOne();

    res.status(200).json({
      success: true,
      data: {},
    });
  } catch (error) {
    next(error);
  }
};
