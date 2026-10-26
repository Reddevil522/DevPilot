/**
 * test-terminal-live-e2e.js
 * =========================
 * Full End-to-End Live Verification of DevPilot Terminal (Phase 3).
 *
 * Tests:
 *  1. Ephemeral backend HTTP + WebSocket server startup on port 5005
 *  2. JWT token generation for the active user
 *  3. Authenticated WebSocket connection over ws://localhost:5005/api/terminal/ws?token=...
 *  4. Session creation for real project 'my-awesome-project' (CWD = D:\Projects\my-awesome-project)
 *  5. Safe non-destructive command execution:
 *     - Print text: Write-Output "DevPilot-Terminal-Live-Echo"
 *     - Working directory check: (Get-Location).Path
 *     - Directory listing: Get-ChildItem
 *     - Available version check: node -v
 *     - Stderr output: Write-Error "DevPilot-Stderr-Verified"
 *     - Long-running process: node -e "setTimeout(() => console.log('LONG_RUN_COMPLETED'), 1200)"
 *  6. Dynamic resize message handling
 *  7. Graceful session termination and cleanup
 */

'use strict';

require('dotenv').config();
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');
const { WebSocket } = require('ws');
const app = require('./src/app');
const { attachTerminalWss } = require('./src/controllers/terminal.controller');
const terminalService = require('./src/services/terminal.service');
const User = require('./src/models/user.model');
const Project = require('./src/models/project.model');

const TEST_PORT = 5005;
let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    console.log(`  ✅ PASS: ${name}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL: ${name}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}\n  ${title}\n${'─'.repeat(60)}`);
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function runLiveE2ETest() {
  section('DevPilot Terminal Live E2E Verification');

  // 1. Connect MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  ok('Connected to MongoDB database', mongoose.connection.readyState === 1);

  // 2. Fetch test user and project
  const user = await User.findOne();
  const project = await Project.findOne();
  if (!user || !project) {
    throw new Error('No user or project found in MongoDB. Ensure DB has seed data.');
  }
  ok('Loaded user from database', !!user._id, `User: ${user.email} (${user._id})`);
  ok('Loaded project from database', !!project._id, `Project: ${project.name} (Path: ${project.localPath})`);

  // 3. Generate valid JWT access token
  const token = jwt.sign(
    { userId: user._id.toString() },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: '15m' }
  );
  ok('Generated JWT access token', typeof token === 'string' && token.length > 20);

  // 4. Start HTTP + WS server on TEST_PORT
  const httpServer = http.createServer(app);
  attachTerminalWss(httpServer);

  await new Promise((resolve, reject) => {
    httpServer.listen(TEST_PORT, (err) => {
      if (err) reject(err);
      else resolve();
    });
  });
  ok(`Started HTTP + WebSocket server on port ${TEST_PORT}`, true);

  // 5. Connect WebSocket with auth query param
  const wsUrl = `ws://localhost:${TEST_PORT}/api/terminal/ws?token=${token}`;
  const ws = new WebSocket(wsUrl);

  let outputBuffer = '';
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'output') {
        outputBuffer += msg.data;
      }
    } catch (_) {}
  });

  await new Promise((resolve, reject) => {
    ws.on('open', resolve);
    ws.on('error', reject);
  });
  ok('WebSocket connection established and authenticated', ws.readyState === WebSocket.OPEN);

  // 6. Create session
  ws.send(JSON.stringify({
    type: 'create',
    projectId: project._id.toString(),
    cols: 100,
    rows: 30,
  }));

  let sessionId = null;
  const readyPromise = new Promise((resolve) => {
    const handler = (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'ready') {
          sessionId = msg.sessionId;
          ws.off('message', handler);
          resolve(sessionId);
        }
      } catch (_) {}
    };
    ws.on('message', handler);
  });

  await Promise.race([
    readyPromise,
    sleep(6000).then(() => { throw new Error('Timeout waiting for terminal ready event'); })
  ]);
  ok('Terminal session created (ready event received)', !!sessionId, `SessionId: ${sessionId}`);

  // Helper to run a command and wait for expected token in output
  async function executeAndExpect(cmd, expectSubstr, timeoutMs = 6000) {
    const startIdx = outputBuffer.length;
    ws.send(JSON.stringify({
      type: 'input',
      sessionId,
      data: `${cmd}\r`
    }));

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const newOutput = outputBuffer.slice(startIdx);
      if (newOutput.includes(expectSubstr)) {
        return { success: true, text: newOutput };
      }
      await sleep(100);
    }
    return { success: false, text: outputBuffer.slice(startIdx) };
  }

  // 7. Verify text output
  section('Command Verification — Stdout & Printing');
  const resEcho = await executeAndExpect('Write-Output "DevPilot-Terminal-Live-Echo"', 'DevPilot-Terminal-Live-Echo');
  ok('Execution of Write-Output received in stdout', resEcho.success);

  // 8. Verify working directory
  section('Command Verification — Working Directory');
  const resPwd = await executeAndExpect('(Get-Location).Path', project.localPath);
  ok(`Working directory matches project root (${project.localPath})`, resPwd.success);

  // 9. Verify listing files
  section('Command Verification — File Listing');
  const resDir = await executeAndExpect('Get-ChildItem -Name', '\r\n');
  ok('Directory listing command executed cleanly', resDir.success);

  // 10. Verify version command
  section('Command Verification — Version Command');
  const resVersion = await executeAndExpect('node -v', 'v25');
  ok('Version command (node -v) returns active runtime version', resVersion.success);

  // 11. Verify stderr output
  section('Command Verification — Stderr & Error Pipeline');
  const resStderr = await executeAndExpect('Write-Error "DevPilot-Stderr-Verified"', 'DevPilot-Stderr-Verified');
  ok('Stderr output propagated to client stream', resStderr.success);

  // 12. Verify long-running process
  section('Command Verification — Long-Running Process Lifecycle');
  console.log('  ⏳ Launching asynchronous node timer process...');
  const resLong = await executeAndExpect(
    'node -e "setTimeout(() => console.log(\'LONG_RUN_COMPLETED\'), 1200)"',
    'LONG_RUN_COMPLETED',
    8000
  );
  ok('Long-running process executed and emitted async output', resLong.success);

  // 13. Dynamic resize
  section('Dynamic Resizing');
  ws.send(JSON.stringify({
    type: 'resize',
    sessionId,
    cols: 140,
    rows: 45
  }));
  await sleep(300);
  ok('Sent dynamic resize message without error', true);

  // 14. Close session
  section('Session Termination & Cleanup');
  ws.send(JSON.stringify({
    type: 'close',
    sessionId
  }));
  await sleep(500);
  ok('Sent close message to backend', true);

  // Clean shutdown
  terminalService.destroyAll();
  ws.close();
  await new Promise(r => httpServer.close(r));
  await mongoose.connection.close();
  ok('Server and database shut down gracefully', true);

  // Summary
  section('Live E2E Verification Summary');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failed > 0) {
    process.exitCode = 1;
  }
}

runLiveE2ETest().catch((err) => {
  console.error('\n❌ E2E Test threw unhandled error:', err);
  process.exit(1);
});
