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
      slug,
      description: description || '',
      technology: resolvedTech,
      template,
      projectType,
      localPath: projectType === 'local' ? projectDir : undefined,
      ownerId: req.user.id,
      status: 'active',
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
      slug,
      description: description || '',
      technology: resolvedTech,
      template,
      projectType,
      localPath: projectType === 'local' ? projectDir : undefined,
      ownerId: req.user.id,
      status: 'active',
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

// @desc    Get all projects for authenticated user (sorted by recent usage)
// @route   GET /api/projects
// @access  Private
exports.getProjects = async (req, res, next) => {
  try {
    const projects = await Project.find({ ownerId: req.user.id }).sort('-lastOpenedAt -updatedAt');

    res.status(200).json({
      success: true,
      count: projects.length,
      data: projects,
    });
  } catch (error) {
    next(error);
  }
};

// @desc    Get single project and update lastOpenedAt
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

    // Update lastOpenedAt for recent projects tracking
    project.lastOpenedAt = new Date();
    await project.save();

    res.status(200).json({
      success: true,
      data: project,
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

      // 2. Safety check: verify identity file if it exists
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
        // If identity file does not exist, proceed
        if (idErr.code !== 'ENOENT') {
          console.warn('[deleteProject] Identity check warning:', idErr.message);
        }
      }

      // 3. Physically delete the local directory
      try {
        await fs.rm(project.localPath, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 });
      } catch (rmErr) {
        if (rmErr.code === 'ENOENT') {
          console.log(`[deleteProject] Local folder already removed: ${project.localPath}`);
        } else {
          console.warn(`[deleteProject] Warning removing folder ${project.localPath}: ${rmErr.code} - ${rmErr.message}. Proceeding with database deletion.`);
        }
      }
    }

    // 4. Always remove project metadata from MongoDB so user is never stuck
    await project.deleteOne();

    res.status(200).json({
      success: true,
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


