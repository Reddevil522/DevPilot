const express = require('express');
const {
  createProject,
  createProjectStream,
  getProjects,
  getProject,
  getProjectFiles,
  updateProject,
  deleteProject,
} = require('../controllers/project.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

// Apply auth middleware to all routes
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

module.exports = router;
