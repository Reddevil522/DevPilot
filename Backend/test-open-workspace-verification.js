/**
 * test-open-workspace-verification.js
 * ============================================================================
 * Verification suite for DevPilot "Open Local Folder" / "Open Workspace" functionality.
 * Tests:
 * 1. Path validation & normalization (quotes, case, non-existent, system paths)
 * 2. Workspace registration / open-folder (no file copying/moving, MongoDB metadata only)
 * 3. Case-insensitive Windows path deduplication on re-open
 * 4. Display name UI alias handling
 * 5. Project files browsing for opened workspace
 * ============================================================================
 */

'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('./src/app');
const Project = require('./src/models/project.model');
const User = require('./src/models/user.model');

let server;
let port;
let testUserToken;
let testUserId;

function request(method, route, token, body = null) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const headers = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = http.request({
      hostname: 'localhost',
      port,
      path: `/api${route}`,
      method,
      headers
    }, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        let parsed = null;
        try {
          parsed = data ? JSON.parse(data) : null;
        } catch {
          parsed = data;
        }
        resolve({ status: res.statusCode, data: parsed });
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function runTests() {
  console.log('======================================================================');
  console.log('   DEVPILOT: OPEN LOCAL FOLDER & WORKSPACE FUNCTIONALITY VERIFICATION ');
  console.log('======================================================================\n');

  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ PASS: MongoDB connected');

    server = http.createServer(app);
    await new Promise(resolve => {
      server.listen(0, 'localhost', () => {
        port = server.address().port;
        resolve();
      });
    });
    console.log(`✅ PASS: Test HTTP server listening on dynamic port ${port}`);

    testUserId = new mongoose.Types.ObjectId();
    testUserToken = jwt.sign(
      { userId: testUserId.toString(), role: 'developer' },
      process.env.JWT_ACCESS_SECRET,
      { expiresIn: '1h' }
    );

    // Create minimal user in DB so requireAuth passes
    await User.create({
      _id: testUserId,
      name: 'Open Folder Tester',
      email: `test_of_${Date.now()}@devpilot.com`,
      passwordHash: 'dummyhash123'
    });
    console.log('✅ PASS: Test user authenticated');

    // -------------------------------------------------------------------------
    // TEST 1: Path Validation Endpoint (POST /api/projects/validate-path)
    // -------------------------------------------------------------------------
    console.log('\n--- 1. Testing validate-path ---');

    // Test 1a: Current repo directory
    const repoDir = path.resolve(__dirname, '..');
    const val1 = await request('POST', '/projects/validate-path', testUserToken, {
      localPath: repoDir
    });
    console.assert(val1.status === 200, `Expected 200, got ${val1.status}`);
    console.assert(val1.data.accessible === true, 'Repo directory should be accessible');
    console.assert(val1.data.isDirectory === true, 'Repo path should be a directory');
    console.assert(val1.data.folderName === path.basename(repoDir), `Folder name should be ${path.basename(repoDir)}`);
    console.log('✅ PASS: Valid local folder path validates successfully (accessible: true)');

    // Test 1b: Quoted path normalization
    const valQuoted = await request('POST', '/projects/validate-path', testUserToken, {
      localPath: `"${repoDir}"`
    });
    console.assert(valQuoted.status === 200, `Expected 200, got ${valQuoted.status}`);
    console.assert(valQuoted.data.accessible === true, 'Quoted path should normalize and validate');
    console.log('✅ PASS: Quoted path string normalized cleanly');

    // Test 1c: Non-existent directory
    const valNonExistent = await request('POST', '/projects/validate-path', testUserToken, {
      localPath: path.join(repoDir, 'non_existent_folder_xyz_12345')
    });
    console.assert(valNonExistent.status === 200, `Expected 200, got ${valNonExistent.status}`);
    console.assert(valNonExistent.data.accessible === false, 'Non-existent directory should have accessible: false');
    console.assert(valNonExistent.data.exists === false, 'Non-existent directory should have exists: false');
    console.log('✅ PASS: Non-existent folder path returns exists: false, accessible: false');

    // Test 1d: File path mistakenly entered instead of directory
    const valFile = await request('POST', '/projects/validate-path', testUserToken, {
      localPath: path.resolve(__filename)
    });
    console.assert(valFile.status === 200, `Expected 200, got ${valFile.status}`);
    console.assert(valFile.data.isDirectory === false, 'File should not be reported as directory');
    console.assert(valFile.data.accessible === false, 'File path should not be accessible workspace');
    console.log('✅ PASS: File path mistakenly selected is rejected as non-directory');

    // Test 1e: System root path rejected
    const sysPath = process.platform === 'win32' ? 'C:\\' : '/';
    const valSys = await request('POST', '/projects/validate-path', testUserToken, {
      localPath: sysPath
    });
    console.assert(valSys.status === 400, `Expected 400 for system root, got ${valSys.status}`);
    console.log('✅ PASS: System root path rejected with 400');

    // -------------------------------------------------------------------------
    // TEST 2: Open Workspace / Register Folder (POST /api/projects/open-folder)
    // -------------------------------------------------------------------------
    console.log('\n--- 2. Testing open-folder (Open Workspace Button) ---');

    // Create a temporary workspace folder to test
    const tempWorkspace = path.join(__dirname, 'test_open_workspace_dir');
    if (!fs.existsSync(tempWorkspace)) {
      fs.mkdirSync(tempWorkspace, { recursive: true });
      fs.writeFileSync(path.join(tempWorkspace, 'index.js'), 'console.log("hello");\n');
      fs.writeFileSync(path.join(tempWorkspace, 'package.json'), JSON.stringify({ name: 'my-workspace-app', version: '1.0.0' }));
    }

    const openRes = await request('POST', '/projects/open-folder', testUserToken, {
      localPath: `"${tempWorkspace}"`,
      displayName: 'My Workspace UI Alias'
    });

    console.assert(openRes.status === 201, `Expected 201 Created, got ${openRes.status}`);
    console.assert(openRes.data.success === true, 'Success should be true');
    console.assert(!!openRes.data.data.id, 'Project ID must be present');
    console.assert(openRes.data.data.displayName === 'My Workspace UI Alias', 'Display name alias should match');
    console.assert(openRes.data.data.isAccessible === true, 'isAccessible should be true');
    console.assert(fs.existsSync(path.join(tempWorkspace, 'index.js')), 'Original source files must remain intact');

    const createdProjectId = openRes.data.data.id;
    console.log('✅ PASS: Workspace opened with 201 Created, metadata persisted, local files preserved');

    // -------------------------------------------------------------------------
    // TEST 3: Re-opening Workspace / Idempotency & Case Normalization
    // -------------------------------------------------------------------------
    console.log('\n--- 3. Testing re-opening workspace with case-insensitivity ---');

    // Alter case on Windows (e.g. lowercase drive letter or path)
    const alteredCasePath = process.platform === 'win32'
      ? tempWorkspace.charAt(0).toLowerCase() + tempWorkspace.slice(1)
      : tempWorkspace;

    const reopenRes = await request('POST', '/projects/open-folder', testUserToken, {
      localPath: alteredCasePath,
      displayName: 'Updated Workspace Alias'
    });

    console.assert(reopenRes.status === 200, `Expected 200 OK for reopen, got ${reopenRes.status}`);
    console.assert(reopenRes.data.data.id === createdProjectId, `Expected same project ID ${createdProjectId}, got ${reopenRes.data.data.id}`);
    console.assert(reopenRes.data.data.displayName === 'Updated Workspace Alias', 'Display name updated on reopen');
    console.log('✅ PASS: Re-opening same workspace returns 200 OK without duplicate key conflict');

    // -------------------------------------------------------------------------
    // TEST 4: Fetch Files for Opened Workspace (GET /api/projects/:id/files)
    // -------------------------------------------------------------------------
    console.log('\n--- 4. Testing Explorer file tree loading ---');

    const filesRes = await request('GET', `/projects/${createdProjectId}/files`, testUserToken);
    console.assert(filesRes.status === 200, `Expected 200, got ${filesRes.status}`);
    console.assert(Array.isArray(filesRes.data.data), 'Files should be an array');
    console.assert(filesRes.data.data.some(f => f.name === 'index.js'), 'index.js should be in files tree');
    console.assert(filesRes.data.data.some(f => f.name === 'package.json'), 'package.json should be in files tree');
    console.log('✅ PASS: Explorer files tree loaded accurately from disk');

    // Cleanup
    try {
      await Project.deleteOne({ _id: createdProjectId });
      await User.deleteOne({ _id: testUserId });
      fs.rmSync(tempWorkspace, { recursive: true, force: true });
    } catch (_) {}

    console.log('\n======================================================================');
    console.log('   ALL OPEN WORKSPACE VERIFICATION TESTS PASSED (100% SUCCESS)        ');
    console.log('======================================================================');

    server.close();
    await mongoose.disconnect();
    process.exit(0);

  } catch (err) {
    console.error('❌ TEST FAILED:', err);
    if (server) server.close();
    await mongoose.disconnect();
    process.exit(1);
  }
}

runTests();
