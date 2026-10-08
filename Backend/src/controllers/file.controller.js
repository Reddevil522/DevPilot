const FileSystemService = require('../services/filesystem.service');
const Project = require('../models/project.model');
const watcherService = require('../services/watcher.service');

// Middleware helper to load project and check permissions
const loadProject = async (req, res, id) => {
  const project = await Project.findById(id);
  if (!project) return { error: 'Project not found', status: 404 };
  if (project.ownerId.toString() !== req.user.id) return { error: 'Not authorized', status: 403 };
  if (project.projectType !== 'local' || !project.localPath) return { error: 'Only local projects supported', status: 400 };
  return { project };
};

exports.readFile = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    const content = await FileSystemService.readFile(project.localPath, req.query.path);
    res.status(200).json({ success: true, data: content });
  } catch (error) {
    next(error);
  }
};

exports.writeFile = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.writeFile(project.localPath, req.body.path, req.body.content);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.createFile = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.createFile(project.localPath, req.body.path, req.body.content);
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.createFolder = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.createFolder(project.localPath, req.body.path);
    res.status(201).json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.deletePath = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    const isFolder = req.query.isFolder === 'true';
    if (isFolder) {
      await FileSystemService.deleteFolder(project.localPath, req.query.path);
    } else {
      await FileSystemService.deleteFile(project.localPath, req.query.path);
    }
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

exports.renamePath = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.rename(project.localPath, req.body.oldPath, req.body.newPath);
    res.status(200).json({ success: true });
  } catch (error) {
    next(error);
  }
};

// SSE Endpoint for file watching
exports.watchProject = async (req, res) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    // Set headers for SSE
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();

    // Start watching this project
    watcherService.watch(project.localPath);

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Watching files...' })}\n\n`);

    // Listener function
    const onFileEvent = (event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    watcherService.on('file-event', onFileEvent);

    // Handle client disconnect
    req.on('close', () => {
      watcherService.off('file-event', onFileEvent);
      // NOTE: We don't stop the watcher completely here because other clients/tabs might be watching.
      // But in a single-user system, we could.
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'SSE Error' });
  }
};
