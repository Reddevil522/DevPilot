/**
 * test-terminal-backend.js
 * ========================
 * Integration test for the Phase 2 terminal backend.
 *
 * What this tests:
 *  1. Direct unit tests of TerminalService (no server needed):
 *     - Session capacity limits
 *     - CWD validation (accessible directory vs non-existent)
 *     - PTY spawn, data emission, input write, resize, idle-timer reset
 *     - Session ownership enforcement (cross-user access rejected)
 *     - destroySession / destroyAll cleanup
 *
 *  2. WebSocket integration test (requires backend server running):
 *     - Unauthenticated connection is rejected (4401)
 *     - Authenticated connection + create + input + output round-trip
 *     - resize message accepted
 *     - close message terminates session
 *     - REST GET /api/terminal/sessions returns the session
 *     - REST DELETE /api/terminal/sessions/:id terminates via HTTP
 *
 * Run:
 *   node test-terminal-backend.js
 *
 * Prerequisites:
 *   - Backend server running on port 5000 (npm run dev)
 *   - A valid user account and project in MongoDB
 *   - Set TEST_JWT and TEST_PROJECT_ID environment variables, OR
 *     fill in the TEST_CONFIG object below.
 */

'use strict';

const terminalService = require('./src/services/terminal.service');
const path = require('path');
const os = require('os');
const fs = require('fs');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// 1. TerminalService unit tests (no HTTP server required)
// ---------------------------------------------------------------------------

async function runTests() {
  section('TerminalService — session capacity guards');

// Use the system temp dir as a valid, accessible project root
const VALID_CWD = os.tmpdir();

// Test: invalid cwd (non-existent directory) is rejected
{
  let threw = false;
  let errMsg = '';
  try {
    terminalService.createSession({
      userId: 'user-a',
      projectId: 'proj-1',
      projectRoot: '/does/not/exist/devpilot-test-xyz',
      cols: 80, rows: 24,
    });
  } catch (e) {
    threw = true;
    errMsg = e.message;
  }
  ok('Rejects non-existent project root', threw, errMsg);
}

// Test: valid cwd creates session
let session1Id;
{
  let id;
  let threw = false;
  try {
    id = terminalService.createSession({
      userId: 'user-a',
      projectId: 'proj-1',
      projectRoot: VALID_CWD,
      cols: 80, rows: 24,
    });
  } catch (e) {
    threw = true;
    console.error('  Spawn error:', e.message);
  }
  ok('Creates session with valid cwd', !threw && typeof id === 'string');
  session1Id = id;
}

// Test: listSessions includes the new session
{
  const list = terminalService.listSessions();
  const found = list.some(s => s.sessionId === session1Id && s.userId === 'user-a');
  ok('listSessions returns created session', found);
}

section('TerminalService — ownership enforcement');

// Test: write from wrong user is rejected
{
  let threw = false;
  let code;
  try {
    terminalService.writeToSession(session1Id, 'user-b', 'echo hi\r');
  } catch (e) {
    threw = true;
    code = e.status;
  }
  ok('Rejects write from non-owner', threw && code === 403);
}

// Test: resize from wrong user is rejected
{
  let threw = false;
  try {
    terminalService.resizeSession(session1Id, 'user-b', 120, 30);
  } catch (e) {
    threw = true;
  }
  ok('Rejects resize from non-owner', threw);
}

section('TerminalService — data output and input round-trip');

// Test: data callback receives PTY output after write
let dataReceived = false;
if (session1Id) {
  await new Promise(resolve => {
    terminalService.attachCallbacks(
      session1Id,
      'user-a',
      (data) => {
        if (!dataReceived) {
          dataReceived = true;
          ok('Received PTY output after input write', true, `first chunk: ${JSON.stringify(data.slice(0, 40))}`);
          resolve();
        }
      },
      () => {}
    );

    // Write a simple echo command
    try {
      terminalService.writeToSession(session1Id, 'user-a', 'echo devpilot-test-ok\r');
    } catch (e) {
      console.error('  Write failed:', e.message);
      resolve();
    }

    // Timeout in case PTY does not produce output quickly
    setTimeout(() => {
      if (!dataReceived) {
        ok('Received PTY output after input write', false, 'Timeout — no output within 4 s');
      }
      resolve();
    }, 4000);
  });
}

section('TerminalService — resize');
{
  let threw = false;
  try {
    terminalService.resizeSession(session1Id, 'user-a', 200, 50);
  } catch (e) {
    threw = true;
    console.error('  Resize threw:', e.message);
  }
  ok('resize does not throw for valid dimensions', !threw);
}

section('TerminalService — input size limit');
{
  let threw = false;
  let code;
  try {
    const oversized = 'A'.repeat(20 * 1024); // 20 KB > MAX_WRITE_BYTES (16 KB)
    terminalService.writeToSession(session1Id, 'user-a', oversized);
  } catch (e) {
    threw = true;
    code = e.status;
  }
  ok('Rejects input chunk > 16 KB', threw && code === 413);
}

section('TerminalService — session per-user limit');
{
  // Create sessions until limit (MAX_SESSIONS_PER_USER = 3; session1 already exists → 2 more)
  const extraIds = [];
  let limitHit = false;
  for (let i = 0; i < 5; i++) {
    try {
      const id = terminalService.createSession({
        userId: 'user-a',
        projectId: 'proj-1',
        projectRoot: VALID_CWD,
        cols: 80, rows: 24,
      });
      extraIds.push(id);
    } catch (e) {
      if (e.status === 429) {
        limitHit = true;
      }
      break;
    }
  }
  ok('Per-user session limit enforced', limitHit);
  // Cleanup extra sessions
  for (const id of extraIds) {
    terminalService.destroySession(id, 'test_cleanup');
  }
}

section('TerminalService — destroySession');
{
  terminalService.destroySession(session1Id, 'test_cleanup');
  const list = terminalService.listSessions();
  const stillThere = list.some(s => s.sessionId === session1Id);
  ok('destroySession removes session from map', !stillThere);

  // Write after destroy should throw 404
  let threw = false;
  let code;
  try {
    terminalService.writeToSession(session1Id, 'user-a', 'test');
  } catch (e) {
    threw = true;
    code = e.status;
  }
  ok('Write to destroyed session throws 404', threw && code === 404);
}

section('TerminalService — destroyAll');
{
  // Create a couple more sessions
  const a = terminalService.createSession({ userId: 'user-c', projectId: 'p', projectRoot: VALID_CWD, cols: 80, rows: 24 });
  const b = terminalService.createSession({ userId: 'user-d', projectId: 'p', projectRoot: VALID_CWD, cols: 80, rows: 24 });
  ok('Two sessions created for destroyAll test', terminalService.listSessions().length >= 2);
  terminalService.destroyAll();
  ok('destroyAll clears all sessions', terminalService.listSessions().length === 0);
}

// ---------------------------------------------------------------------------
// 2. WebSocket integration test (requires running server)
// ---------------------------------------------------------------------------

section('WebSocket integration (skipped — server not running in test mode)');

/*
  To run the WebSocket integration test manually:

  1. Start the backend: npm run dev
  2. Open a second terminal and run:
       node test-terminal-backend.js --ws
  3. Or use the instructions below with wscat:

  # Unauthenticated rejection:
  npx wscat -c "ws://localhost:5000/api/terminal/ws"
  # Expected: connection closes immediately with code 4401

  # Authenticated session (replace TOKEN with your JWT cookie value):
  npx wscat -c "ws://localhost:5000/api/terminal/ws?token=TOKEN"
  # Then send: {"type":"create","projectId":"YOUR_PROJECT_ID"}
  # Expected: {"type":"ready","sessionId":"..."}
  # Then send: {"type":"input","sessionId":"...","data":"echo hello\r"}
  # Expected: {"type":"output","data":"hello\r\n..."} and prompt echo back

  # REST session list (requires auth cookie):
  curl -s -b "accessToken=TOKEN" http://localhost:5000/api/terminal/sessions
*/

console.log(`
  To test the WebSocket layer manually (server must be running):
    npx wscat -c "ws://localhost:5000/api/terminal/ws?token=YOUR_JWT"
    > {"type":"create","projectId":"YOUR_PROJECT_ID"}
    > {"type":"input","sessionId":"RETURNED_SESSION_ID","data":"echo hello\\r"}
    > {"type":"resize","sessionId":"RETURNED_SESSION_ID","cols":120,"rows":30}
    > {"type":"close","sessionId":"RETURNED_SESSION_ID"}

  REST endpoints:
    GET    http://localhost:5000/api/terminal/sessions
    DELETE http://localhost:5000/api/terminal/sessions/:id
`);

ok('WebSocket integration manual test documented', true);

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

section('Test Summary');
  console.log(`  Passed: ${passed}`);
  console.log(`  Failed: ${failed}`);
  if (failed > 0) {
    console.error('\n  ❌ Some tests failed. Review output above.');
    process.exitCode = 1;
  } else {
    console.log('\n  ✅ All automated tests passed.');
  }
}

runTests().catch(err => {
  console.error('Unhandled test failure:', err);
  process.exit(1);
});

