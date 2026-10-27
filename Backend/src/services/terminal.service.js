/**
 * TerminalService
 * ---------------
 * Manages pseudoterminal (PTY) sessions via node-pty.
 *
 * Design decisions:
 *  - Each session is identified by a server-generated UUID (sessionId).
 *  - Sessions are bound to (userId, projectId). Cross-user access is refused.
 *  - The initial working directory is ALWAYS project.localPath — clients cannot
 *    supply an arbitrary cwd.
 *  - Output is forwarded through a registered per-session callback (the WS send
 *    function). No unbounded ring-buffer is kept in memory.
 *  - An idle-timeout kills processes that have had no I/O for MAX_IDLE_MS.
 *  - On server shutdown all sessions are destroyed gracefully.
 *
 * Security boundaries enforced HERE (not just in the controller):
 *  - Sessions are only created by the controller after ownership verification.
 *  - `resize` and `write` both re-verify the sessionId belongs to the userId.
 *  - Shell executable is chosen from a server-side whitelist; clients never
 *    pass the shell command.
 */

'use strict';

const pty = require('node-pty');
const { randomUUID } = require('crypto');
const path = require('path');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Maximum number of concurrent terminal sessions across all users. */
const MAX_SESSIONS = 20;

/** Maximum number of sessions a single user may hold simultaneously. */
const MAX_SESSIONS_PER_USER = 3;

/** Maximum number of bytes buffered per write before back-pressure is applied. */
const MAX_WRITE_BYTES = 1024 * 16; // 16 KB per input chunk

/** Kill idle sessions after this many milliseconds of silence. */
const MAX_IDLE_MS = 30 * 60 * 1000; // 30 minutes

/** Minimum terminal dimensions. */
const MIN_COLS = 10;
const MIN_ROWS = 2;
const MAX_COLS = 500;
const MAX_ROWS = 200;

// Default shell selection for Windows
const DEFAULT_SHELL_WINDOWS = process.env.DEVPILOT_SHELL || 'powershell.exe';
const DEFAULT_SHELL_ARGS_WINDOWS = ['-NoLogo'];

// ---------------------------------------------------------------------------
// Session store
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} TerminalSession
 * @property {string}   sessionId
 * @property {string}   userId
 * @property {string}   projectId
 * @property {string}   projectRoot  - Absolute local path of the project
 * @property {object}   pty          - node-pty IPty instance
 * @property {number}   createdAt    - epoch ms
 * @property {number}   lastActivity - epoch ms
 * @property {Function} onData       - Registered output callback (set after spawn)
 * @property {Function} onExit       - Registered exit callback
 * @property {ReturnType<typeof setTimeout>} idleTimer
 */

/** @type {Map<string, TerminalSession>} */
const sessions = new Map();

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Clamp a numeric dimension to [min, max].
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clampDim(val, min, max) {
  const n = Number(val);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, Math.round(n)));
}

/**
 * Reset the idle timer for a session.
 * @param {TerminalSession} session
 */
function resetIdleTimer(session) {
  session.lastActivity = Date.now();
  if (session.idleTimer) clearTimeout(session.idleTimer);
  session.idleTimer = setTimeout(() => {
    console.log(`[Terminal] Session ${session.sessionId} idle timeout — destroying.`);
    destroySession(session.sessionId, 'idle_timeout');
  }, MAX_IDLE_MS);
  // Allow the timer not to block Node exit
  if (session.idleTimer.unref) session.idleTimer.unref();
}

/**
 * Resolve the correct shell executable.
 * Clients never choose this — the server decides based on OS.
 * @returns {{ shell: string, args: string[] }}
 */
function resolveShell() {
  if (process.platform === 'win32') {
    return { shell: DEFAULT_SHELL_WINDOWS, args: DEFAULT_SHELL_ARGS_WINDOWS };
  }
  // Linux/Mac fallback (not primary target but kept for correctness)
  return { shell: process.env.SHELL || '/bin/bash', args: [] };
}

/**
 * Verify that `projectRoot` is an accessible directory.
 * Throws with status 400 if not.
 * @param {string} projectRoot
 */
function assertProjectRootAccessible(projectRoot) {
  if (!projectRoot) {
    const err = new Error('Project has no local path configured.');
    err.status = 400;
    throw err;
  }
  try {
    const stat = fs.statSync(projectRoot);
    if (!stat.isDirectory()) {
      const err = new Error(`Project root is not a directory: ${projectRoot}`);
      err.status = 400;
      throw err;
    }
  } catch (e) {
    if (e.status) throw e;
    const err = new Error(`Project root is not accessible: ${projectRoot}`);
    err.status = 400;
    throw err;
  }
}

/**
 * Count active sessions for a given userId.
 * @param {string} userId
 * @returns {number}
 */
function countUserSessions(userId) {
  let count = 0;
  for (const s of sessions.values()) {
    if (s.userId === userId) count++;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new PTY session for an authenticated user and their project.
 *
 * @param {object} params
 * @param {string} params.userId        - Authenticated user ID (from req.user)
 * @param {string} params.projectId     - MongoDB project ID
 * @param {string} params.projectRoot   - Absolute path from project.localPath
 * @param {number} [params.cols=100]    - Initial terminal columns
 * @param {number} [params.rows=24]     - Initial terminal rows
 * @returns {string} sessionId
 */
function createSession({ userId, projectId, projectRoot, cols = 100, rows = 24 }) {
  // Capacity guards
  if (sessions.size >= MAX_SESSIONS) {
    const err = new Error('Terminal capacity reached. Please close an existing terminal session.');
    err.status = 503;
    throw err;
  }
  if (countUserSessions(userId) >= MAX_SESSIONS_PER_USER) {
    const err = new Error(`You already have ${MAX_SESSIONS_PER_USER} terminal sessions open. Please close one first.`);
    err.status = 429;
    throw err;
  }

  // Validate project root
  assertProjectRootAccessible(projectRoot);

  const safeCols = clampDim(cols, MIN_COLS, MAX_COLS);
  const safeRows = clampDim(rows, MIN_ROWS, MAX_ROWS);
  const { shell, args } = resolveShell();

  console.log(`[Terminal] Spawning "${shell}" for user=${userId} project=${projectId} cwd="${projectRoot}"`);

  let ptyProcess;
  try {
    ptyProcess = pty.spawn(shell, args, {
      name: 'xterm-256color',
      cols: safeCols,
      rows: safeRows,
      cwd: projectRoot,
      env: buildSafeEnv(projectRoot),
    });
  } catch (spawnErr) {
    console.error('[Terminal] PTY spawn failed:', spawnErr);
    const err = new Error(`Failed to start terminal: ${spawnErr.message}`);
    err.status = 500;
    throw err;
  }

  const sessionId = randomUUID();

  /** @type {TerminalSession} */
  const session = {
    sessionId,
    userId,
    projectId,
    projectRoot,
    pty: ptyProcess,
    createdAt: Date.now(),
    lastActivity: Date.now(),
    onData: null,
    onExit: null,
    idleTimer: null,
  };

  sessions.set(sessionId, session);

  // Wire PTY data → registered callback
  ptyProcess.onData((data) => {
    resetIdleTimer(session);
    if (typeof session.onData === 'function') {
      session.onData(data);
    }
  });

  // Wire PTY exit → registered callback then cleanup
  ptyProcess.onExit(({ exitCode, signal }) => {
    console.log(`[Terminal] Session ${sessionId} exited — code=${exitCode} signal=${signal}`);
    if (typeof session.onExit === 'function') {
      session.onExit(exitCode, signal);
    }
    // Remove from map on exit (PTY already dead)
    _removeSession(sessionId);
  });

  resetIdleTimer(session);

  console.log(`[Terminal] Session ${sessionId} created (total active: ${sessions.size})`);
  return sessionId;
}

/**
 * Register a data-output callback for an existing session.
 * This is called by the WebSocket handler once the connection is established.
 *
 * @param {string} sessionId
 * @param {string} userId    - Must match the session owner
 * @param {Function} onData  - Called with (string) chunks of PTY output
 * @param {Function} onExit  - Called with (exitCode, signal) when process exits
 */
function attachCallbacks(sessionId, userId, onData, onExit) {
  const session = _requireOwnedSession(sessionId, userId);
  session.onData = onData;
  session.onExit = onExit;
}

/**
 * Write user input to a PTY session.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @param {string} data
 */
function writeToSession(sessionId, userId, data) {
  const session = _requireOwnedSession(sessionId, userId);

  if (typeof data !== 'string') {
    throw Object.assign(new Error('Input must be a string.'), { status: 400 });
  }

  // Enforce per-write size limit to prevent memory spikes
  if (Buffer.byteLength(data, 'utf8') > MAX_WRITE_BYTES) {
    throw Object.assign(new Error('Input chunk too large.'), { status: 413 });
  }

  resetIdleTimer(session);
  session.pty.write(data);
}

/**
 * Resize a PTY session.
 *
 * @param {string} sessionId
 * @param {string} userId
 * @param {number} cols
 * @param {number} rows
 */
function resizeSession(sessionId, userId, cols, rows) {
  const session = _requireOwnedSession(sessionId, userId);
  const safeCols = clampDim(cols, MIN_COLS, MAX_COLS);
  const safeRows = clampDim(rows, MIN_ROWS, MAX_ROWS);
  resetIdleTimer(session);
  try {
    session.pty.resize(safeCols, safeRows);
  } catch (e) {
    // Resize on a dead PTY is non-fatal
    console.warn(`[Terminal] Resize failed for ${sessionId}:`, e.message);
  }
}

/**
 * Destroy a terminal session, killing the underlying process.
 *
 * @param {string} sessionId
 * @param {string} reason  - Human-readable reason for logging
 */
function destroySession(sessionId, reason = 'client_disconnect') {
  const session = sessions.get(sessionId);
  if (!session) return; // Already gone
  console.log(`[Terminal] Destroying session ${sessionId} (reason: ${reason})`);
  _killSession(session);
}

/**
 * Validate that sessionId is owned by userId. Returns the session or throws.
 * @param {string} sessionId
 * @param {string} userId
 * @returns {TerminalSession}
 */
function _requireOwnedSession(sessionId, userId) {
  const session = sessions.get(sessionId);
  if (!session) {
    throw Object.assign(new Error('Terminal session not found.'), { status: 404 });
  }
  if (session.userId !== userId) {
    throw Object.assign(new Error('Access denied to this terminal session.'), { status: 403 });
  }
  return session;
}

/**
 * Kill the PTY process and remove the session from the map.
 * @param {TerminalSession} session
 */
function _killSession(session) {
  if (session.idleTimer) {
    clearTimeout(session.idleTimer);
    session.idleTimer = null;
  }
  try {
    session.pty.kill();
  } catch (e) {
    // PTY may already be dead
  }
  _removeSession(session.sessionId);
}

/**
 * Remove a session from the map (does NOT kill the process).
 * @param {string} sessionId
 */
function _removeSession(sessionId) {
  if (sessions.delete(sessionId)) {
    console.log(`[Terminal] Session ${sessionId} removed (remaining: ${sessions.size})`);
  }
}

/**
 * Build a safe environment for the child process.
 * - Inherits the server's own process.env (so PATH, USERPROFILE, etc. work).
 * - Removes credentials that could leak to the shell.
 * - Adds DEVPILOT-specific vars.
 *
 * @param {string} projectRoot
 * @returns {Record<string, string>}
 */
function buildSafeEnv(projectRoot) {
  const env = { ...process.env };

  // Remove server-side secrets from shell environment
  const secretKeys = [
    'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET',
    'MONGODB_URI', 'SMTP_PASS', 'SMTP_USER',
    'INTERNAL_AI_SECRET',
  ];
  for (const key of secretKeys) {
    delete env[key];
  }

  // Helpful terminal hints
  env.TERM = 'xterm-256color';
  env.DEVPILOT_PROJECT_ROOT = projectRoot;

  return env;
}

/**
 * Destroy all active sessions. Called on server shutdown.
 */
function destroyAll() {
  console.log(`[Terminal] Server shutdown — destroying ${sessions.size} active session(s).`);
  for (const session of sessions.values()) {
    _killSession(session);
  }
}

/**
 * Return a snapshot of active session metadata (no PTY handles exposed).
 * For diagnostic/status use only.
 * @returns {Array<{sessionId, userId, projectId, createdAt, lastActivity}>}
 */
function listSessions() {
  return Array.from(sessions.values()).map(s => ({
    sessionId: s.sessionId,
    userId: s.userId,
    projectId: s.projectId,
    createdAt: s.createdAt,
    lastActivity: s.lastActivity,
  }));
}

// ---------------------------------------------------------------------------
// Server shutdown hook
// ---------------------------------------------------------------------------
process.once('exit', destroyAll);
process.once('SIGINT', () => { destroyAll(); process.exit(0); });
process.once('SIGTERM', () => { destroyAll(); process.exit(0); });

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------
module.exports = {
  createSession,
  attachCallbacks,
  writeToSession,
  resizeSession,
  destroySession,
  destroyAll,
  listSessions,
};
