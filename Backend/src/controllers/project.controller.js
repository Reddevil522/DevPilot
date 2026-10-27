const Project = require('../models/project.model');
const mongoose = require('mongoose');
const ProjectGeneratorService = require('../services/project-generator.service');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { generateUniqueSlug } = require('../utils/slug.util');
const watcherService = require('../services/watcher.service');

// Removed warmupScript per user instructions.


// Directories to skip during traversal (never recurse into these)
const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.devpilot', '.angular', 'dist', 'build',
  '.cache', '.next', 'target', 'coverage', '.idea', '__pycache__',
  '.venv', 'vendor'
]);

/**
 * Check whether a target path is an OS system root or protected directory.
 * @param {string} targetPath
 * @returns {boolean}
 */
function isSystemPath(targetPath) {
  if (!targetPath || typeof targetPath !== 'string') return true;
  try {
    const resolved = path.resolve(targetPath);
    const parsed = path.parse(resolved);

    // Root check (e.g. C:\ or /)
    if (resolved.toLowerCase() === parsed.root.toLowerCase() || resolved === path.dirname(resolved)) {
      return true;
    }

    if (process.platform === 'win32') {
      const lower = resolved.toLowerCase();
      const winDir = (process.env.WINDIR || 'C:\\Windows').toLowerCase();
      const progFiles = (process.env.ProgramFiles || 'C:\\Program Files').toLowerCase();
      const progFilesX86 = (process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)').toLowerCase();
      const sysRoot = (process.env.SystemRoot || 'C:\\Windows').toLowerCase();

      if (
        lower === winDir || lower.startsWith(winDir + '\\') ||
        lower === progFiles || lower.startsWith(progFiles + '\\') ||
        lower === progFilesX86 || lower.startsWith(progFilesX86 + '\\') ||
        lower === sysRoot || lower.startsWith(sysRoot + '\\') ||
        lower.includes('$recycle.bin') ||
        lower.includes('system volume information')
      ) {
        return true;
      }
    } else {
      const blockedPrefixes = ['/bin', '/sbin', '/usr', '/etc', '/var', '/proc', '/sys', '/dev', '/boot', '/lib', '/lib64', '/root', '/lost+found'];
      for (const prefix of blockedPrefixes) {
        if (resolved === prefix || resolved.startsWith(prefix + '/')) {
          return true;
        }
      }
    }
    return false;
  } catch {
    return true;
  }
}

/**
 * Check if a directory path exists and is accessible.
 * @param {string} dirPath
 * @returns {Promise<boolean>}
 */
async function checkPathAccessible(dirPath) {
  if (!dirPath || typeof dirPath !== 'string') return false;
  try {
    const stat = await fs.stat(dirPath);
    return stat.isDirectory();
  } catch {
    return false;
  }
}

/**
 * Auto-detect project technology from existing files in a directory.
 * @param {string} dirPath
 * @returns {Promise<{ tech: string, lang: string }>}
 */
async function detectTechnology(dirPath) {
  try {
    const pkgPath = path.join(dirPath, 'package.json');
    const pkgStat = await fs.stat(pkgPath).catch(() => null);
    if (pkgStat && pkgStat.isFile()) {
      const raw = await fs.readFile(pkgPath, 'utf8');
      const pkg = JSON.parse(raw);
      const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };

      if (deps['@angular/core']) return { tech: 'angular', lang: 'TypeScript' };
      if (deps['react'] || deps['next']) return { tech: 'react', lang: 'JavaScript' };
      if (deps['express'] || deps['koa'] || deps['fastify']) return { tech: 'express', lang: 'JavaScript' };
      return { tech: 'nodejs', lang: 'JavaScript' };
    }

    const entries = await fs.readdir(dirPath).catch(() => []);
    if (entries.some(e => e.endsWith('.py') || e === 'requirements.txt' || e === 'Pipfile')) {
      return { tech: 'custom', lang: 'Python' };
    }
    if (entries.some(e => e.endsWith('.rs') || e === 'Cargo.toml')) {
      return { tech: 'custom', lang: 'Rust' };
    }
    if (entries.some(e => e.endsWith('.go') || e === 'go.mod')) {
      return { tech: 'custom', lang: 'Go' };
    }
  } catch (_) {}
  return { tech: 'custom', lang: 'JavaScript' };
}

/**
 * Build a shallow (depth-1) file tree for a directory.
 * Folders are returned with childrenLoaded=false and an empty children array
 * so the client can request children lazily when the user expands the folder.
 *
 * @param {string} dirPath      - Absolute path to the directory to read.
 * @param {string} relativePath - Relative path prefix for node paths (empty at root).
 * @returns {Promise<Array>}    - Sorted array of FileNode objects (depth-1 only).
 */
async function buildShallowTree(dirPath, relativePath = '') {
  let entries;
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch (err) {
    // Inaccessible directory (permissions, drive unavailable, etc.) — return empty
    console.warn(`[Explorer] Cannot read directory: ${dirPath} — ${err.code}`);
    return [];
  }

  const nodes = [];

  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;

    const nodeRelPath = relativePath ? `${relativePath}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      // Shallow: do NOT recurse. Mark as not yet loaded so client can lazy-load.
      nodes.push({
        name: entry.name,
        type: 'folder',
        path: nodeRelPath,
        isOpen: false,
        childrenLoaded: false,
        children: []
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

// Helper to infer technology from template if not explicitly provided
function inferTechnology(template, explicitTech) {
  if (explicitTech && explicitTech !== 'custom') return explicitTech;
  if (template === 'angular' || template === 'mean') return 'angular';
  if (template === 'mern') return 'react';
  if (template === 'node-api' || template === 'express') return 'nodejs';
  if (template === 'ai-app') return 'fullstack';
  return explicitTech || 'nodejs';
}

// @desc    Create new project
// @route   POST /api/projects
// @access  Private
exports.createProject = async (req, res, next) => {
  try {
    let { name, description, technology, template, projectType = 'local', localPath } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({ success: false, message: 'Project name is required' });
    }

    if (projectType === 'local' && (!localPath || !localPath.trim())) {
      return res.status(400).json({ success: false, message: 'Local path is required for local projects' });
    }

    name = name.trim();
    localPath = localPath ? localPath.trim() : '';

    // Calculate final project path: full absolute local path
    const resolvedParent = path.resolve(localPath);
    const projectDir = path.basename(resolvedParent).toLowerCase() === name.toLowerCase()
      ? resolvedParent
      : path.join(resolvedParent, name);

    // Duplicate Check 1: MongoDB by name
    const existingByName = await Project.findOne({ ownerId: req.user.id, name });
    if (existingByName) {
      return res.status(400).json({
        success: false,
        message: `A project named "${name}" already exists in your workspace.`
      });
    }

    // Duplicate Check 2: MongoDB by localPath
    if (projectType === 'local') {
      const existingByPath = await Project.findOne({ ownerId: req.user.id, localPath: projectDir });
      if (existingByPath) {
        return res.status(400).json({
          success: false,
          message: `A project at "${projectDir}" is already registered.`
        });
      }

      // Duplicate Check 3: Local Filesystem
      try {
        const stats = await fs.stat(projectDir);
        if (stats.isDirectory()) {
          const entries = await fs.readdir(projectDir);
          if (entries.length > 0) {
            return res.status(400).json({
              success: false,
              message: `Directory "${projectDir}" already exists and is not empty.`
            });
          }
        }
      } catch (err) {
        // Directory does not exist yet — expected
      }
    }

    const projectId = new mongoose.Types.ObjectId();
    const resolvedTech = inferTechnology(template, technology);

    // Generate project files locally
    const generator = new ProjectGeneratorService();
    if (projectType === 'local') {
      await generator.generate(projectDir, name, template, description, projectId.toString(), resolvedTech, projectType);

      // Verify local project creation
      try {
        const verifyStats = await fs.stat(projectDir);
        if (!verifyStats.isDirectory()) {
          throw new Error(`Project directory "${projectDir}" is not a valid directory.`);
        }
        const createdEntries = await fs.readdir(projectDir);
        if (createdEntries.length === 0) {
          throw new Error(`Project directory "${projectDir}" is empty after generation.`);
        }
      } catch (vErr) {
        return res.status(500).json({
          success: false,
          message: `Verification failed: Could not verify local project creation at "${projectDir}". ${vErr.message}`
        });
      }
    }

    const slug = await generateUniqueSlug(name, req.user.id);

    // Persist ONLY project metadata to MongoDB (no files or contents)
    const project = await Project.create({
      _id: projectId,
      name,
      displayName: name,
      slug,
      description: description || '',
      technology: resolvedTech,
      template,
      projectType,
      localPath: projectType === 'local' ? projectDir : undefined,
      ownerId: req.user.id,
      status: 'active',
      isImported: false,
      lastOpenedAt: new Date(),
      syncStatus: 'LOCAL_ONLY',
      language: resolvedTech === 'angular' ? 'TypeScript' : 'JavaScript',
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
    let { name, description, technology, template, projectType = 'local', localPath } = req.body;

    if (!name || !name.trim()) {
      sendEvent({ type: 'error', message: 'Project name is required' });
      return res.end();
    }

    if (projectType === 'local' && (!localPath || !localPath.trim())) {
      sendEvent({ type: 'error', message: 'Local path is required for local projects' });
      return res.end();
    }

    name = name.trim();
    localPath = localPath ? localPath.trim() : '';

    // Calculate final project path: full absolute local path
    const resolvedParent = path.resolve(localPath);
    const projectDir = path.basename(resolvedParent).toLowerCase() === name.toLowerCase()
      ? resolvedParent
      : path.join(resolvedParent, name);

    // Duplicate Check 1: MongoDB by name
    const existingByName = await Project.findOne({ ownerId: req.user.id, name });
    if (existingByName) {
      sendEvent({ type: 'error', message: `A project named "${name}" already exists in your workspace.` });
      return res.end();
    }

    // Duplicate Check 2: MongoDB by localPath
    if (projectType === 'local') {
      const existingByPath = await Project.findOne({ ownerId: req.user.id, localPath: projectDir });
      if (existingByPath) {
        sendEvent({ type: 'error', message: `A project at "${projectDir}" is already registered.` });
        return res.end();
      }

      // Duplicate Check 3: Local Filesystem
      try {
        const stats = await fs.stat(projectDir);
        if (stats.isDirectory()) {
          const entries = await fs.readdir(projectDir);
          if (entries.length > 0) {
            sendEvent({ type: 'error', message: `Directory "${projectDir}" already exists on disk and is not empty.` });
            return res.end();
          }
        }
      } catch (err) {
        // Directory does not exist yet — expected
      }
    }

    const projectId = new mongoose.Types.ObjectId();
    const resolvedTech = inferTechnology(template, technology);

    const generator = new ProjectGeneratorService((message) => {
      sendEvent({ type: 'progress', message });
    });

    sendEvent({ type: 'progress', message: `Creating local project at ${projectDir}...` });

    if (projectType === 'local') {
      await generator.generate(projectDir, name, template, description, projectId.toString(), resolvedTech, projectType);

      // Verify local project creation
      sendEvent({ type: 'progress', message: 'Verifying local project files on disk...' });
      const verifyStats = await fs.stat(projectDir);
      if (!verifyStats.isDirectory()) {
        throw new Error(`Project directory "${projectDir}" is not a valid directory.`);
      }
      const createdEntries = await fs.readdir(projectDir);
      if (createdEntries.length === 0) {
        throw new Error(`Project directory "${projectDir}" is empty after generation.`);
      }
    }

    sendEvent({ type: 'progress', message: 'Saving project metadata to database...' });

    const slug = await generateUniqueSlug(name, req.user.id);

    // Persist ONLY project metadata to MongoDB (no files or contents)
    const project = await Project.create({
      _id: projectId,
      name,
      displayName: name,
      slug,
      description: description || '',
      technology: resolvedTech,
      template,
      projectType,
      localPath: projectType === 'local' ? projectDir : undefined,
      ownerId: req.user.id,
      status: 'active',
      isImported: false,
      lastOpenedAt: new Date(),
      syncStatus: 'LOCAL_ONLY',
      language: resolvedTech === 'angular' ? 'TypeScript' : 'JavaScript',
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

// @desc    Register an existing local directory as a DevPilot project (no scaffolding, metadata only)
// @route   POST /api/projects/open-folder
// @desc    Register an existing local directory as a DevPilot workspace
// @route   POST /api/projects/open-folder
// @access  Private
exports.registerExistingFolder = async (req, res, next) => {
  try {
    let { localPath, name, displayName, description, technology } = req.body;

    if (!localPath || typeof localPath !== 'string' || !localPath.trim()) {
      return res.status(400).json({ success: false, message: 'Local path is required' });
    }

    const resolvedPath = path.resolve(localPath.trim());

    // Security check 1: reject obvious system roots & OS directories
    if (isSystemPath(resolvedPath)) {
      return res.status(400).json({
        success: false,
        message: 'System roots and OS system directories cannot be registered as project workspaces.'
      });
    }

    // Resolve canonical path (following symlinks to prevent bypass)
    let realRoot;
    try {
      realRoot = await fs.realpath(resolvedPath);
    } catch (rpErr) {
      if (rpErr.code === 'ENOENT') {
        return res.status(404).json({
          success: false,
          message: `Directory "${resolvedPath}" does not exist.`
        });
      }
      if (rpErr.code === 'EACCES' || rpErr.code === 'EPERM') {
        return res.status(403).json({
          success: false,
          message: `Permission denied: Cannot access directory "${resolvedPath}". Restricted permissions.`
        });
      }
      return res.status(400).json({
        success: false,
        message: `Failed to resolve path "${resolvedPath}": ${rpErr.message}`
      });
    }

    // Security check 2: check canonical real path against system paths
    if (isSystemPath(realRoot)) {
      return res.status(400).json({
        success: false,
        message: 'System roots and OS system directories cannot be registered as project workspaces.'
      });
    }

    // Filesystem verification: must be a directory
    const stat = await fs.stat(realRoot);
    if (!stat.isDirectory()) {
      return res.status(400).json({
        success: false,
        message: `Path "${realRoot}" is a file, not a directory.`
      });
    }

    // Validate read permissions explicitly
    try {
      await fs.access(realRoot, fs.constants.R_OK);
      await fs.readdir(realRoot);
    } catch (permErr) {
      return res.status(403).json({
        success: false,
        message: `Permission denied: Cannot read directory "${realRoot}". Restricted permissions.`
      });
    }

    // Deduplication check: if already registered by this user, return existing project without creating duplicate
    const existingByPath = await Project.findOne({ ownerId: req.user.id, localPath: realRoot });
    if (existingByPath) {
      existingByPath.lastOpenedAt = new Date();
      existingByPath.status = 'active';
      if (displayName && displayName.trim()) {
        existingByPath.displayName = displayName.trim();
      } else if (name && name.trim() && name.trim() !== existingByPath.name) {
        existingByPath.displayName = name.trim();
      }
      await existingByPath.save();

      const projectData = existingByPath.toObject();
      projectData.isAccessible = true;

      return res.status(200).json({
        success: true,
        data: projectData,
        message: 'Project workspace re-opened successfully.'
      });
    }

    // Determine project name (use supplied name or fallback to folder base name)
    const folderBaseName = path.basename(realRoot) || 'workspace';
    const rawName = (name && name.trim())
      ? name.trim()
      : ((displayName && displayName.trim())
          ? displayName.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-')
          : folderBaseName);

    // Ensure candidate project name is unique for this user if another project at different path exists
    let candidateName = rawName;
    let counter = 2;
    while (await Project.findOne({ ownerId: req.user.id, name: candidateName })) {
      candidateName = `${rawName}-${counter}`;
      counter++;
    }

    const resolvedDisplayName = (displayName && displayName.trim())
      ? displayName.trim()
      : ((name && name.trim()) ? name.trim() : folderBaseName);

    // Detect technology and language from existing project files
    const detected = await detectTechnology(realRoot);
    const finalTech = (technology && technology !== 'custom') ? technology : detected.tech;
    const finalLang = detected.lang;

    // Generate unique slug for this owner
    const slug = await generateUniqueSlug(candidateName, req.user.id);
    const projectId = new mongoose.Types.ObjectId();

    // Write non-destructive .devpilot/project.json marker if writable (tolerates read-only gracefully)
    try {
      const devpilotDir = path.join(realRoot, '.devpilot');
      await fs.mkdir(devpilotDir, { recursive: true });
      await fs.writeFile(
        path.join(devpilotDir, 'project.json'),
        JSON.stringify({ projectId: projectId.toString(), version: 1, registeredAt: new Date().toISOString() }, null, 2),
        'utf8'
      );
    } catch (mErr) {
      console.warn(`[registerExistingFolder] Could not write .devpilot marker: ${mErr.message}`);
    }

    // Persist project metadata ONLY in MongoDB (no source code copied into DB)
    const project = await Project.create({
      _id: projectId,
      name: candidateName,
      displayName: resolvedDisplayName,
      slug,
      description: description ? description.trim() : '',
      technology: finalTech,
      template: 'custom',
      projectType: 'local',
      localPath: realRoot,
      ownerId: req.user.id,
      status: 'active',
      isImported: true,
      deletionPolicy: 'METADATA_ONLY',
      lastOpenedAt: new Date(),
      syncStatus: 'LOCAL_ONLY',
      language: finalLang,
    });

    const projectData = project.toObject();
    projectData.isAccessible = true;

    return res.status(201).json({
      success: true,
      data: projectData,
      message: 'Workspace folder registered successfully.'
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        success: false,
        message: 'A project with this name or path is already registered.'
      });
    }
    next(error);
  }
};

// @desc    Pre-flight validation of local workspace directory path
// @route   POST /api/projects/validate-path
// @access  Private
exports.validateWorkspacePath = async (req, res) => {
  try {
    const { localPath } = req.body;
    if (!localPath || typeof localPath !== 'string' || !localPath.trim()) {
      return res.status(400).json({ success: false, message: 'Local path is required.' });
    }

    const resolved = path.resolve(localPath.trim());

    if (isSystemPath(resolved)) {
      return res.status(400).json({
        success: false,
        message: 'System roots and OS system directories cannot be used as workspaces.'
      });
    }

    let realRoot;
    try {
      realRoot = await fs.realpath(resolved);
    } catch (rpErr) {
      if (rpErr.code === 'ENOENT') {
        return res.status(200).json({
          success: true,
          exists: false,
          isDirectory: false,
          accessible: false,
          resolvedPath: resolved,
          message: 'Directory does not exist.'
        });
      }
      if (rpErr.code === 'EACCES' || rpErr.code === 'EPERM') {
        return res.status(200).json({
          success: true,
          exists: true,
          isDirectory: false,
          accessible: false,
          resolvedPath: resolved,
          message: 'Permission denied: Cannot access directory.'
        });
      }
      return res.status(200).json({
        success: true,
        exists: false,
        isDirectory: false,
        accessible: false,
        resolvedPath: resolved,
        message: rpErr.message
      });
    }

    if (isSystemPath(realRoot)) {
      return res.status(400).json({
        success: false,
        message: 'System roots and OS system directories cannot be used as workspaces.'
      });
    }

    const stat = await fs.stat(realRoot);
    if (!stat.isDirectory()) {
      return res.status(200).json({
        success: true,
        exists: true,
        isDirectory: false,
        accessible: false,
        resolvedPath: realRoot,
        message: 'Path exists but is a file, not a directory.'
      });
    }

    try {
      await fs.access(realRoot, fs.constants.R_OK);
      const entries = await fs.readdir(realRoot);
      const detected = await detectTechnology(realRoot);
      const folderName = path.basename(realRoot);

      return res.status(200).json({
        success: true,
        exists: true,
        isDirectory: true,
        accessible: true,
        entriesCount: entries.length,
        resolvedPath: realRoot,
        folderName,
        detectedTechnology: detected.tech,
        detectedLanguage: detected.lang
      });
    } catch (readErr) {
      return res.status(200).json({
        success: true,
        exists: true,
        isDirectory: true,
        accessible: false,
        resolvedPath: realRoot,
        message: 'Directory exists but read permissions are restricted.'
      });
    }
  } catch (err) {
    return res.status(500).json({ success: false, message: err.message });
  }
};

// @desc    Get all projects for authenticated user (enriched with live filesystem accessibility)
// @route   GET /api/projects
// @access  Private
exports.getProjects = async (req, res, next) => {
  try {
    const query = { ownerId: req.user.id };

    if (req.query.status && ['active', 'inactive', 'archived'].includes(req.query.status)) {
      query.status = req.query.status;
    }

    let queryBuilder = Project.find(query).sort('-lastOpenedAt -updatedAt');

    if (req.query.limit) {
      const limit = Math.min(Math.max(1, parseInt(req.query.limit, 10) || 50), 100);
      queryBuilder = queryBuilder.limit(limit);
    }
    if (req.query.skip) {
      const skip = Math.max(0, parseInt(req.query.skip, 10) || 0);
      queryBuilder = queryBuilder.skip(skip);
    }

    const projects = await queryBuilder;

    // Check filesystem accessibility for local projects
    const enrichedProjects = await Promise.all(
      projects.map(async (p) => {
        const obj = p.toObject();
        if (p.projectType === 'local' && p.localPath) {
          obj.isAccessible = await checkPathAccessible(p.localPath);
        } else {
          obj.isAccessible = p.projectType === 'cloud';
        }
        return obj;
      })
    );

    res.status(200).json({
      success: true,
      count: enrichedProjects.length,
      data: enrichedProjects,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single project by ID and update lastOpenedAt
// @route   GET /api/projects/:id
// @access  Private
exports.getProject = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format.' });
    }

    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Ensure user is project owner
    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this project' });
    }

    // Update lastOpenedAt unless explicitly disabled
    if (req.query.updateLastOpened !== 'false') {
      project.lastOpenedAt = new Date();
      await project.save();
    }

    const obj = project.toObject();
    obj.isAccessible = project.projectType === 'local' && project.localPath
      ? await checkPathAccessible(project.localPath)
      : true;

    res.status(200).json({
      success: true,
      data: obj,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Update project last-opened timestamp explicitly
// @route   PATCH /api/projects/:id/last-opened
// @access  Private
exports.updateLastOpened = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format.' });
    }

    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to access this project' });
    }

    project.lastOpenedAt = new Date();
    await project.save();

    res.status(200).json({
      success: true,
      data: {
        id: project.id,
        lastOpenedAt: project.lastOpenedAt
      }
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get project files (shallow root — depth-1 only, then lazy-load children)
// @route   GET /api/projects/:id/files
// @access  Private
exports.getProjectFiles = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format.' });
    }

    const t0 = Date.now();
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

    // Verify local directory exists
    const accessible = await checkPathAccessible(project.localPath);
    if (!accessible) {
      return res.status(404).json({
        success: false,
        message: `Project local directory "${project.localPath}" is not accessible on disk.`,
        isAccessible: false
      });
    }

    // Shallow read — only the root level. Children loaded on-demand.
    const fileTree = await buildShallowTree(project.localPath);
    console.log(`[PERF][getProjectFiles] shallow root in ${Date.now() - t0}ms (${fileTree.length} entries)`);
    res.status(200).json({ success: true, data: fileTree });
  } catch (error) {
    next(error);
  }
};

// @desc    Get children of a specific folder path (lazy loading for Explorer)
// @route   GET /api/projects/:id/files/children?path=src/components
// @access  Private
exports.getDirectoryChildren = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format.' });
    }

    const t0 = Date.now();
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

    // Resolve the requested relative path against the project root
    const relativeFolderPath = req.query.path || '';
    const absoluteFolderPath = relativeFolderPath
      ? path.join(project.localPath, relativeFolderPath)
      : project.localPath;

    // Security: ensure the resolved path stays within the project root
    const resolvedPath = path.resolve(absoluteFolderPath);
    const resolvedRoot = path.resolve(project.localPath);
    if (!resolvedPath.startsWith(resolvedRoot + path.sep) && resolvedPath !== resolvedRoot) {
      return res.status(400).json({ success: false, message: 'Path traversal not allowed' });
    }

    const children = await buildShallowTree(resolvedPath, relativeFolderPath);
    console.log(`[PERF][getDirectoryChildren] "${relativeFolderPath || '/'}" in ${Date.now() - t0}ms (${children.length} entries)`);
    res.status(200).json({ success: true, data: children });
  } catch (error) {
    next(error);
  }
};

// @desc    Update permitted project metadata
// @route   PATCH /api/projects/:id
// @access  Private
exports.updateProject = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format.' });
    }

    let project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Ensure user is project owner
    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to update this project' });
    }

    // Only allow updating permitted metadata fields
    const {
      name,
      displayName,
      description,
      status,
      gitBranch,
      gitRepo,
      deploymentUrl,
      technology,
      language,
      localPath: newLocalPath
    } = req.body;

    const updateFields = {};
    if (name && name.trim()) updateFields.name = name.trim();
    if (displayName !== undefined) updateFields.displayName = displayName ? displayName.trim() : updateFields.name;
    if (description !== undefined) updateFields.description = description.trim();
    if (status && ['active', 'inactive', 'archived'].includes(status)) updateFields.status = status;
    if (gitBranch !== undefined) updateFields.gitBranch = gitBranch.trim();
    if (gitRepo !== undefined) updateFields.gitRepo = gitRepo.trim();
    if (deploymentUrl !== undefined) updateFields.deploymentUrl = deploymentUrl.trim();
    if (technology && ['angular', 'react', 'nodejs', 'express', 'fullstack', 'custom'].includes(technology)) {
      updateFields.technology = technology;
    }
    if (language !== undefined) updateFields.language = language.trim();

    // If localPath is being updated (relocated workspace), validate existence and permissions
    if (newLocalPath && newLocalPath !== project.localPath) {
      const resolved = path.resolve(newLocalPath.trim());
      if (isSystemPath(resolved)) {
        return res.status(400).json({ success: false, message: 'System directories cannot be used as workspaces.' });
      }
      const accessible = await checkPathAccessible(resolved);
      if (!accessible) {
        return res.status(400).json({ success: false, message: `Directory "${resolved}" is not accessible on disk.` });
      }
      updateFields.localPath = resolved;
    }

    project = await Project.findByIdAndUpdate(req.params.id, updateFields, {
      returnDocument: 'after',
      runValidators: true,
    });

    const obj = project.toObject();
    obj.isAccessible = project.projectType === 'local' && project.localPath
      ? await checkPathAccessible(project.localPath)
      : true;

    res.status(200).json({
      success: true,
      data: obj,
    });
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ success: false, message: 'A project with this name already exists.' });
    }
    next(error);
  }
};

// @desc    Delete project metadata or unregister workspace (preserves files unless explicitly requested)
// @route   DELETE /api/projects/:id
// @access  Private
exports.deleteProject = async (req, res, next) => {
  try {
    if (!mongoose.Types.ObjectId.isValid(req.params.id)) {
      return res.status(400).json({ success: false, message: 'Invalid project ID format.' });
    }

    const project = await Project.findById(req.params.id);

    if (!project) {
      return res.status(404).json({ success: false, message: 'Project not found' });
    }

    // Ensure user is project owner
    if (project.ownerId.toString() !== req.user.id) {
      return res.status(403).json({ success: false, message: 'Not authorized to delete this project' });
    }

    // Determine deletion mode:
    // Imported/existing folders are NEVER deleted physically from disk.
    // Scaffolded projects are only deleted physically if query ?deleteFiles=true is explicitly passed.
    const shouldDeleteFiles = req.query.deleteFiles === 'true' && !project.isImported;

    if (project.projectType === 'local' && project.localPath) {
      // 1. Stop any active file watcher so Node itself is not locking the directory
      try {
        if (watcherService && typeof watcherService.stop === 'function') {
          if (watcherService.currentProjectRoot === project.localPath) {
            await watcherService.stop();
          }
        }
      } catch (wErr) {
        console.warn('[deleteProject] Failed to stop watcher:', wErr);
      }

      // 2. Physical deletion ONLY if explicitly requested and NOT an imported folder
      if (shouldDeleteFiles) {
        // Safety check: verify identity file if it exists
        const identityPath = path.join(project.localPath, '.devpilot', 'project.json');
        try {
          const identityContent = await fs.readFile(identityPath, 'utf8');
          const identity = JSON.parse(identityContent);

          if (identity.projectId && identity.projectId !== project.id) {
            return res.status(400).json({
              success: false,
              message: 'Project identity mismatch. Aborting physical deletion for safety.'
            });
          }
        } catch (idErr) {
          if (idErr.code !== 'ENOENT') {
            console.warn('[deleteProject] Identity check warning:', idErr.message);
          }
        }

        try {
          await fs.rm(project.localPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
        } catch (rmErr) {
          if (rmErr.code === 'ENOENT') {
            console.log(`[deleteProject] Local folder already removed: ${project.localPath}`);
          } else {
            console.warn(`[deleteProject] Warning removing folder ${project.localPath}: ${rmErr.code} - ${rmErr.message}.`);
          }
        }
      }
    }

    // 3. Remove project metadata from MongoDB
    await project.deleteOne();

    res.status(200).json({
      success: true,
      message: shouldDeleteFiles
        ? 'Project and local files deleted successfully.'
        : 'Project unlinked from DevPilot successfully. Local files preserved.',
      data: {},
    });
  } catch (error) {
    next(error);
  }
};

let activePickerProcess = null;

// @desc    Select a local directory using native file picker
// @route   GET /api/projects/system/select-directory
// @access  Private
exports.selectDirectory = (req, res) => {
  // Native desktop GUI folder picker only functions on Windows desktop
  if (process.platform !== 'win32') {
    return res.status(200).json({
      success: false,
      message: 'Native directory picker is only available on desktop environments. Please enter directory path manually.',
      path: null
    });
  }

  const t0 = Date.now();
  const initialPath = req.query.initialPath ? req.query.initialPath.trim() : '';
  console.log(`[PERF][selectDirectory] T0 — request received${initialPath ? ` (initialPath="${initialPath}")` : ''}`);

  // If a previous dialog process is still running, kill it so they don't pile up
  if (activePickerProcess) {
    try {
      activePickerProcess.kill('SIGTERM');
    } catch (e) {}
    activePickerProcess = null;
  }

  // Build the PowerShell script as an array of lines.
  // - $ProgressPreference = 'SilentlyContinue' suppresses PowerShell progress output from stderr.
  // - [System.Windows.Forms.Application]::EnableVisualStyles() applies modern Windows OS visual styles.
  // - We attach a hidden TopMost form as the owner of the dialog. This is critical
  //   because Windows places un-owned dialogs spawned from background processes behind
  //   the active browser window. With TopMost, the dialog is guaranteed to pop up
  //   in the foreground immediately over the browser.
  const scriptLines = [
    '$ProgressPreference = "SilentlyContinue"',
    'Add-Type -AssemblyName System.Windows.Forms',
    '[System.Windows.Forms.Application]::EnableVisualStyles()',
    '$form = New-Object System.Windows.Forms.Form',
    '$form.TopMost = $true',
    '$form.Opacity = 0',
    '$form.ShowInTaskbar = $false',
    '$form.FormBorderStyle = [System.Windows.Forms.FormBorderStyle]::None',
    '$form.Size = New-Object System.Drawing.Size(1, 1)',
    '$form.StartPosition = [System.Windows.Forms.FormStartPosition]::CenterScreen',
    '$form.Show()',
    '$form.BringToFront()',
    '$form.Activate()',
    '$dlg = New-Object System.Windows.Forms.FolderBrowserDialog',
    '$dlg.Description = "Select project directory"',
    '$dlg.ShowNewFolderButton = $true',
    'try { $dlg.UseDescriptionForTitle = $true } catch {}',
  ];

  if (initialPath) {
    const safeInitial = initialPath.replace(/'/g, "''");
    scriptLines.push(`if (Test-Path -LiteralPath '${safeInitial}') { $dlg.SelectedPath = '${safeInitial}' }`);
  }

  scriptLines.push(
    '$result = $dlg.ShowDialog($form)',
    '$form.Dispose()',
    'if ($result -eq [System.Windows.Forms.DialogResult]::OK) {',
    '    Write-Output $dlg.SelectedPath',
    '}'
  );

  const psScript = scriptLines.join('\n');
  const encodedCmd = Buffer.from(psScript, 'utf16le').toString('base64');
  console.log(`[PERF][selectDirectory] T1 — spawning PowerShell (${Date.now() - t0}ms)`);

  // -Sta is required for WinForms dialogs (Single-Threaded Apartment)
  // Do NOT use -NonInteractive — it prevents GUI dialogs from appearing
  const child = exec(
    `powershell -NoProfile -Sta -ExecutionPolicy Bypass -EncodedCommand ${encodedCmd}`,
    { timeout: 120000 }, // 2-minute timeout to allow user interaction
    (error, stdout, stderr) => {
      if (activePickerProcess === child) {
        activePickerProcess = null;
      }
      console.log(`[PERF][selectDirectory] T2 — dialog closed (${Date.now() - t0}ms total)`);

      if (error && error.killed) {
        console.log('[selectDirectory] Process cancelled/aborted');
        return res.status(200).json({ success: true, path: null });
      }

      if (error) {
        // Log the error for debugging but still check stdout
        console.error('[selectDirectory] PowerShell error:', error.message);
        if (stderr) console.error('[selectDirectory] stderr:', stderr.trim());
      }

      const lines = (stdout || '').trim().split(/\r?\n/);
      const selectedPath = lines[lines.length - 1].trim();

      if (!selectedPath) {
        // User cancelled the dialog — not an error
        console.log(`[PERF][selectDirectory] User cancelled`);
        return res.status(200).json({ success: true, path: null });
      }

      console.log(`[PERF][selectDirectory] T3 — path returned "${selectedPath}" (${Date.now() - t0}ms)`);
      res.status(200).json({ success: true, path: selectedPath });
    }
  );

  activePickerProcess = child;

  // Clean up child process if client disconnects/aborts before dialog closes
  req.on('close', () => {
    if (!res.writableEnded && activePickerProcess === child) {
      try {
        child.kill('SIGTERM');
      } catch (e) {}
      activePickerProcess = null;
    }
  });
};


