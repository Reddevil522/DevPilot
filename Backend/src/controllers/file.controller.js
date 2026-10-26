const FileSystemService = require('../services/filesystem.service');
const Project = require('../models/project.model');
const watcherService = require('../services/watcher.service');

// Middleware helper to load project and check permissions
const loadProject = async (req, res, id) => {
  const project = await Project.findById(id);
  if (!project) return { error: 'Project not found', status: 404 };
  const userId = req.user?.id || req.user?._id?.toString();
  if (project.ownerId.toString() !== userId) return { error: 'Not authorized', status: 403 };
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
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to read file' });
  }
};

exports.writeFile = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.writeFile(project.localPath, req.body.path, req.body.content);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to write file' });
  }
};

exports.createFile = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.createFile(project.localPath, req.body.path, req.body.content);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to create file' });
  }
};

exports.createFolder = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    await FileSystemService.createFolder(project.localPath, req.body.path);
    res.status(201).json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to create folder' });
  }
};

exports.deletePath = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    const targetPath = req.query.path;
    if (!targetPath || targetPath.trim() === '' || targetPath === '.' || targetPath === '/' || targetPath === '\\') {
      return res.status(400).json({ success: false, message: 'Cannot delete project root' });
    }

    const isFolder = req.query.isFolder === 'true';
    if (isFolder) {
      await FileSystemService.deleteFolder(project.localPath, targetPath);
    } else {
      await FileSystemService.deleteFile(project.localPath, targetPath);
    }
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to delete path' });
  }
};

exports.renamePath = async (req, res, next) => {
  try {
    const { project, error, status } = await loadProject(req, res, req.params.id);
    if (error) return res.status(status).json({ success: false, message: error });

    const { oldPath, newPath } = req.body;
    if (!oldPath || !newPath) {
      return res.status(400).json({ success: false, message: 'Both oldPath and newPath are required' });
    }

    await FileSystemService.rename(project.localPath, oldPath, newPath);
    res.status(200).json({ success: true });
  } catch (error) {
    res.status(error.status || 500).json({ success: false, message: error.message || 'Failed to rename path' });
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

    const normalizedRoot = watcherService.normalizeRoot(project.localPath);

    // Start watching this project
    watcherService.watch(project.localPath);

    // Send initial connection event
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', message: 'Watching files...' })}\n\n`);

    // Listener function filtered to this project's events only
    const onFileEvent = (event) => {
      if (event.projectRoot === normalizedRoot) {
        res.write(`data: ${JSON.stringify({ type: event.type, path: event.path, timestamp: event.timestamp })}\n\n`);
      }
    };

    watcherService.on('file-event', onFileEvent);

    // Handle client disconnect
    req.on('close', () => {
      watcherService.off('file-event', onFileEvent);
      watcherService.unwatch(project.localPath).catch(() => {});
    });

  } catch (error) {
    res.status(500).json({ success: false, message: 'SSE Error' });
  }
};
