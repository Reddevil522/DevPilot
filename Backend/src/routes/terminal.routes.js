/**
 * Terminal HTTP REST Routes
 * -------------------------
 * Provides a small REST companion to the WebSocket terminal.
 *
 * These endpoints are deliberately minimal. The actual real-time I/O happens
 * over the WebSocket at /api/terminal/ws — see terminal.controller.js.
 *
 * Routes:
 *   GET  /api/terminal/sessions          — list sessions owned by the current user (diagnostic)
 *   DELETE /api/terminal/sessions/:id    — force-kill a session owned by the current user
 *
 * All routes require full JWT authentication via requireAuth.
 */

'use strict';

const express = require('express');
const router = express.Router();
const { requireAuth } = require('../middleware/auth.middleware');
const terminalService = require('../services/terminal.service');

// All terminal REST routes require full authentication
router.use(requireAuth);

/**
 * GET /api/terminal/sessions
 * Returns the list of terminal sessions owned by the requesting user.
 * Useful for the frontend to detect stale sessions after a page reload.
 */
router.get('/sessions', (req, res) => {
  const userId = req.user._id.toString();
  const all = terminalService.listSessions();
  const mine = all.filter(s => s.userId === userId);
  res.json({ success: true, data: mine });
});

/**
 * DELETE /api/terminal/sessions/:id
 * Force-terminates a session owned by the requesting user.
 */
router.delete('/sessions/:id', (req, res) => {
  const userId = req.user._id.toString();
  const { id: sessionId } = req.params;

  // Verify ownership before killing
  const all = terminalService.listSessions();
  const session = all.find(s => s.sessionId === sessionId);

  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found.' });
  }
  if (session.userId !== userId) {
    return res.status(403).json({ success: false, message: 'Not authorized to close this session.' });
  }

  terminalService.destroySession(sessionId, 'http_delete_request');
  res.json({ success: true, message: 'Session terminated.' });
});

module.exports = router;
