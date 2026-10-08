const express = require('express');
const {
  createProject,
  createProjectStream,
  getProjects,
  getProject,
  getProjectFiles,
  getDirectoryChildren,
  updateProject,
  deleteProject,
  selectDirectory,
} = require('../controllers/project.controller');
const { requireAuth, requireAuthLight } = require('../middleware/auth.middleware');

const router = express.Router();

// select-directory uses requireAuthLight (JWT verify only, no DB query)
// so the native folder picker opens with minimal pre-flight latency.
router.get('/system/select-directory', requireAuthLight, selectDirectory);

// All other routes use the full auth middleware (JWT verify + DB user load)
router.use(requireAuth);


router
  .route('/')
  .get(getProjects)
  .post(createProject);

router
  .route('/stream')
  .post(createProjectStream);

router.route('/:id')
  .get(getProject)
  .patch(updateProject)
  .delete(deleteProject);

router.route('/:id/files')
  .get(getProjectFiles);

// Lazy-load children for a specific folder path
// GET /api/projects/:id/files/children?path=src/components
router.route('/:id/files/children')
  .get(getDirectoryChildren);


module.exports = router;
