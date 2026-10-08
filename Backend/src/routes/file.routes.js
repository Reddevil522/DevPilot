const express = require('express');
const {
  readFile,
  writeFile,
  createFile,
  createFolder,
  deletePath,
  renamePath,
  watchProject
} = require('../controllers/file.controller');
const { requireAuth } = require('../middleware/auth.middleware');

const router = express.Router();

router.use(requireAuth);

router.get('/:id/watch', watchProject);

router.route('/:id/fs')
  .get(readFile)
  .post(createFile)
  .put(writeFile)
  .delete(deletePath);

router.post('/:id/fs/folder', createFolder);
router.patch('/:id/fs/rename', renamePath);

module.exports = router;
