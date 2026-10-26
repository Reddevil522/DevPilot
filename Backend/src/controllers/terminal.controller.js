/**
 * Terminal WebSocket Handler
 * --------------------------
 * Manages the WebSocket upgrade for /api/terminal/ws.
 *
 * Protocol (all messages are JSON strings):
 *
 *  Client → Server:
 *    { type: 'create',  projectId, cols?, rows? }
 *    { type: 'input',   sessionId, data }
 *    { type: 'resize',  sessionId, cols, rows }
 *    { type: 'close',   sessionId }
 *    { type: 'ping' }
 *
 *  Server → Client:
 *    { type: 'ready',   sessionId }
 *    { type: 'output',  data }          ← PTY stdout/stderr (UTF-8 string)
 *    { type: 'exit',    exitCode, signal }
 *    { type: 'error',   message }
 *    { type: 'pong' }
 *
 * Authentication:
 *   The HTTP upgrade request MUST carry the JWT access token in:
 *     - Cookie: accessToken=<jwt>   (primary — same-origin cookie)
 *     - Query:  ?token=<jwt>        (fallback for clients that cannot set cookie
 *                                    headers on the WebSocket constructor)
 *   The handler performs a full JWT verify + DB user load before the upgrade
 *   completes. If auth fails the socket is closed with code 4401.
 *
 * Security:
 *   - Project ownership is verified on every 'create' message.
 *   - Session ownership is re-verified on every 'input', 'resize', 'close'.
 *   - The working directory (project.localPath) is validated server-side.
 *   - Clients never pass the shell command or working directory directly.
 *   - Only one active session per WebSocket connection is enforced at the
 *     protocol level (though TerminalService supports N per user).
 */

'use strict';

const { WebSocketServer } = require('ws');
const jwt = require('jsonwebtoken');
const cookie = require('cookie');
const User = require('../models/user.model');
const Project = require('../models/project.model');
const terminalService = require('../services/terminal.service');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Send a JSON message to a WebSocket client.
 * Silently ignores errors if the socket is already closing/closed.
 * @param {import('ws').WebSocket} ws
 * @param {object} payload
 */
function send(ws, payload) {
  if (ws.readyState === ws.OPEN) {
    try {
      ws.send(JSON.stringify(payload));
    } catch (_) {
      // Socket closed between readyState check and send — safe to ignore
    }
  }
}

/**
 * Authenticate the WS upgrade request.
 * Returns the user document or null.
 * @param {import('http').IncomingMessage} req
 * @returns {Promise<object|null>}
 */
async function authenticateRequest(req) {
  try {
    // 1. Try cookie (primary — same-site HTTP-only cookie)
    let token = null;
    const rawCookies = req.headers.cookie;
    if (rawCookies) {
      const parsed = cookie.parse(rawCookies);
      token = parsed.accessToken || null;
    }

    // 2. Fallback: query string ?token=<jwt>
    //    (Used when browser WS API cannot set custom headers/cookies cross-origin)
    if (!token && req.url) {
      const u = new URL(req.url, 'http://localhost');
      token = u.searchParams.get('token') || null;
    }

    if (!token) return null;

    const decoded = jwt.verify(token, process.env.JWT_ACCESS_SECRET);
    const user = await User.findById(decoded.userId)
      .select('-passwordHash -failedLoginAttempts -lockUntil');
    return user || null;
  } catch {
    return null;
  }
}

/**
 * Verify that a project exists, is owned by userId, and is a local project.
 * Returns the project document or throws with { status, message }.
 * @param {string} projectId
 * @param {string} userId
 * @returns {Promise<object>}
 */
async function authorizeProject(projectId, userId) {
  if (!projectId || typeof projectId !== 'string') {
    throw Object.assign(new Error('projectId is required.'), { status: 400 });
  }

  let project;
  try {
    project = await Project.findById(projectId);
  } catch {
    throw Object.assign(new Error('Invalid projectId.'), { status: 400 });
  }

  if (!project) {
    throw Object.assign(new Error('Project not found.'), { status: 404 });
  }

  if (project.ownerId.toString() !== userId.toString()) {
    throw Object.assign(new Error('You are not authorized to access this project\'s terminal.'), { status: 403 });
  }

  if (project.projectType !== 'local' || !project.localPath) {
    throw Object.assign(
      new Error('Terminal is only available for local projects with a configured path.'),
      { status: 400 }
    );
  }

  return project;
}

// ---------------------------------------------------------------------------
// WebSocket connection handler
// ---------------------------------------------------------------------------

/**
 * Handle a single authenticated WebSocket connection.
 * @param {import('ws').WebSocket} ws
 * @param {object} user - Authenticated user document
 */
function handleConnection(ws, user) {
  const userId = user._id.toString();
  let activeSessionId = null; // Track the session spawned on this connection

  console.log(`[WS-Terminal] Connection opened for user=${userId}`);

  // Heartbeat: respond to pings to keep the connection alive through proxies
  ws.on('message', async (rawMsg) => {
    let msg;
    try {
      msg = JSON.parse(rawMsg.toString());
    } catch {
      send(ws, { type: 'error', message: 'Invalid JSON message.' });
      return;
    }

    const { type } = msg;

    // ---- ping ----
    if (type === 'ping') {
      send(ws, { type: 'pong' });
      return;
    }

    // ---- create ----
    if (type === 'create') {
      // Only one session per WS connection
      if (activeSessionId) {
        send(ws, { type: 'error', message: 'A terminal session is already active on this connection. Close it first.' });
        return;
      }

      let project;
      try {
        project = await authorizeProject(msg.projectId, userId);
      } catch (authErr) {
        send(ws, { type: 'error', message: authErr.message });
        return;
      }

      let sessionId;
      try {
        sessionId = terminalService.createSession({
          userId,
          projectId: msg.projectId,
          projectRoot: project.localPath,
          cols: msg.cols,
          rows: msg.rows,
        });
      } catch (spawnErr) {
        send(ws, { type: 'error', message: spawnErr.message });
        return;
      }

      activeSessionId = sessionId;

      // Register data + exit callbacks
      terminalService.attachCallbacks(
        sessionId,
        userId,
        (data) => send(ws, { type: 'output', data }),
        (exitCode, signal) => {
          send(ws, { type: 'exit', exitCode: exitCode ?? null, signal: signal ?? null });
          activeSessionId = null;
        }
      );

      send(ws, { type: 'ready', sessionId });
      return;
    }

    // ---- input ----
    if (type === 'input') {
      if (!activeSessionId) {
        send(ws, { type: 'error', message: 'No active terminal session. Send "create" first.' });
        return;
      }
      try {
        terminalService.writeToSession(activeSessionId, userId, msg.data ?? '');
      } catch (err) {
        send(ws, { type: 'error', message: err.message });
      }
      return;
    }

    // ---- resize ----
    if (type === 'resize') {
      if (!activeSessionId) {
        send(ws, { type: 'error', message: 'No active terminal session.' });
        return;
      }
      try {
        terminalService.resizeSession(activeSessionId, userId, msg.cols, msg.rows);
      } catch (err) {
        send(ws, { type: 'error', message: err.message });
      }
      return;
    }

    // ---- close ----
    if (type === 'close') {
      if (activeSessionId) {
        terminalService.destroySession(activeSessionId, 'client_close');
        activeSessionId = null;
      }
      ws.close(1000, 'Session closed by client.');
      return;
    }

    send(ws, { type: 'error', message: `Unknown message type: "${type}"` });
  });

  ws.on('close', (code, reason) => {
    console.log(`[WS-Terminal] Connection closed for user=${userId} — code=${code} reason=${reason?.toString()}`);
    if (activeSessionId) {
      terminalService.destroySession(activeSessionId, 'ws_disconnected');
      activeSessionId = null;
    }
  });

  ws.on('error', (err) => {
    console.error(`[WS-Terminal] Socket error for user=${userId}:`, err.message);
    if (activeSessionId) {
      terminalService.destroySession(activeSessionId, 'ws_error');
      activeSessionId = null;
    }
  });
}

// ---------------------------------------------------------------------------
// WebSocket server factory
// ---------------------------------------------------------------------------

/**
 * Attach the terminal WebSocket server to an existing Node.js HTTP server.
 *
 * Usage (in server.js):
 *   const { attachTerminalWss } = require('./controllers/terminal.controller');
 *   attachTerminalWss(httpServer);
 *
 * @param {import('http').Server} httpServer
 */
function attachTerminalWss(httpServer) {
  const wss = new WebSocketServer({
    server: httpServer,
    path: '/api/terminal/ws',
    // Limit message size to 64 KB (protects against malicious input floods)
    maxPayload: 64 * 1024,
  });

  wss.on('connection', async (ws, req) => {
    // Authenticate before touching anything else
    const user = await authenticateRequest(req);
    if (!user) {
      console.warn('[WS-Terminal] Unauthenticated connection rejected.');
      // 4401 is a custom close code indicating authentication failure
      ws.close(4401, 'Authentication required.');
      return;
    }
    handleConnection(ws, user);
  });

  wss.on('error', (err) => {
    console.error('[WS-Terminal] WebSocket server error:', err);
  });

  console.log('[WS-Terminal] Terminal WebSocket server attached at /api/terminal/ws');
  return wss;
}

module.exports = { attachTerminalWss };
