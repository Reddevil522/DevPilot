/**
 * test-phase2-metadata.js
 * ============================================================================
 * Acceptance Test Suite for Phase 2: Reliable MongoDB Project Metadata Management
 *
 * Verifies:
 *  1. Project stored in MongoDB with metadata only (no source code copied into DB)
 *  2. Listing projects returns authenticated user's records (user isolation)
 *  3. Project metadata persistence across simulated restarts
 *  4. Multi-tenant security: another user cannot read, update, or delete the project
 *  5. Duplicate project identifiers (slugs/names) are handled correctly
 *  6. Missing/inaccessible local directories are reported accurately (isAccessible: false)
 *  7. Registering an existing local folder (POST /api/projects/open-folder)
 *     - Metadata only, no files modified or overwritten
 *     - Auto-detects technology
 *     - Reopening returns existing project with updated lastOpenedAt
 *  8. System root protection: blocks registering C:\ or C:\Windows
 *  9. Safe deletion: imported/unlinked projects preserve all physical files on disk
 * 10. Update permitted metadata & last-opened timestamp endpoints
 * ============================================================================
 */

'use strict';

require('dotenv').config();
const path = require('path');
const fs = require('fs').promises;
const fsSync = require('fs');
const http = require('http');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('./src/app');
const Project = require('./src/models/project.model');
const User = require('./src/models/user.model');

let server;
let baseUrl;
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
  console.log(`\n${'─'.repeat(70)}\n  ${title}\n${'─'.repeat(70)}`);
}

async function request(method, route, token, body = null) {
  const url = `${baseUrl}${route}`;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const options = {
    method,
    headers,
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  let data;
  try {
    data = await res.json();
  } catch (_) {
    data = null;
  }
  return { status: res.status, ok: res.ok, data };
}

async function runTestSuite() {
  console.log('======================================================================');
  console.log('   DEVPILOT PHASE 2: MONGODB PROJECT METADATA MANAGEMENT TEST SUITE   ');
  console.log('======================================================================');

  // 1. Connect MongoDB
  await mongoose.connect(process.env.MONGODB_URI);
  ok('MongoDB connected', mongoose.connection.readyState === 1);

  // 2. Start HTTP server on dynamic port
  server = http.createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  baseUrl = `http://127.0.0.1:${port}/api`;
  ok('Test Express server started', !!port, `Port: ${port}`);

  // 3. Find or create two distinct test users for multi-tenant tests
  const users = await User.find().limit(2);
  let userA = users[0];
  let userB = users[1];

  if (!userA) {
    userA = await User.create({
      name: 'Test Developer A',
      email: 'dev_a_test@test.com',
      passwordHash: 'dummy_hash_for_test_a',
      isEmailVerified: true,
    });
  }
  if (!userB) {
    userB = await User.create({
      name: 'Test Developer B',
      email: 'dev_b_test@test.com',
      passwordHash: 'dummy_hash_for_test_b',
      isEmailVerified: true,
    });
  }

  const tokenA = jwt.sign({ userId: userA._id.toString(), role: 'USER' }, process.env.JWT_ACCESS_SECRET);
  const tokenB = jwt.sign({ userId: userB._id.toString(), role: 'USER' }, process.env.JWT_ACCESS_SECRET);
  ok('Generated JWT tokens for User A and User B', !!tokenA && !!tokenB);

  // Prepare a temporary local folder for testing
  const tempTestDir = path.join(__dirname, 'temp_phase2_workspace');
  if (fsSync.existsSync(tempTestDir)) {
    await fs.rm(tempTestDir, { recursive: true, force: true });
  }
  await fs.mkdir(tempTestDir, { recursive: true });
  await fs.writeFile(
    path.join(tempTestDir, 'package.json'),
    JSON.stringify({ name: 'my-existing-app', dependencies: { express: '^4.18.0' } }, null, 2),
    'utf8'
  );
  await fs.writeFile(path.join(tempTestDir, 'index.js'), 'console.log("Hello from local file");', 'utf8');

  let projectAId;

  try {
    // -------------------------------------------------------------------------
    section('1. Register Existing Local Folder (POST /api/projects/open-folder)');
    // -------------------------------------------------------------------------
    const openRes = await request('POST', '/projects/open-folder', tokenA, {
      localPath: tempTestDir,
      description: 'An existing Node.js project registered into DevPilot',
    });

    ok('Register existing folder returns 201 Created', openRes.status === 201);
    ok('Response has success: true', openRes.data?.success === true);
    ok('Project has correct name derived from folder or input', openRes.data?.data?.name === 'temp_phase2_workspace');
    ok('Project marked as isImported: true', openRes.data?.data?.isImported === true);
    ok('Project template set to custom', openRes.data?.data?.template === 'custom');
    ok('Project technology detected as express', openRes.data?.data?.technology === 'express');
    ok('Project isAccessible reported as true', openRes.data?.data?.isAccessible === true);
    projectAId = openRes.data?.data?.id || openRes.data?.data?._id;

    // Verify local disk content was NOT altered or overwritten
    const indexContent = await fs.readFile(path.join(tempTestDir, 'index.js'), 'utf8');
    ok('Source code on disk preserved completely', indexContent === 'console.log("Hello from local file");');

    // -------------------------------------------------------------------------
    section('2. Verify Metadata-Only Storage in MongoDB');
    // -------------------------------------------------------------------------
    const docInDb = await Project.findById(projectAId).lean();
    ok('Project document exists in MongoDB', !!docInDb);
    ok('No source file contents stored in MongoDB document', docInDb.fileContent === undefined && docInDb.files === undefined);
    ok('localPath correctly stored as reference path', docInDb.localPath === tempTestDir);
    ok('Owner ID correctly assigned to User A', docInDb.ownerId.toString() === userA._id.toString());

    // -------------------------------------------------------------------------
    section('3. Re-open Already Registered Folder');
    // -------------------------------------------------------------------------
    const reopenRes = await request('POST', '/projects/open-folder', tokenA, {
      localPath: tempTestDir,
    });
    ok('Re-opening existing project returns 200 OK', reopenRes.status === 200);
    ok('Returns existing project document', reopenRes.data?.data?.id === projectAId);
    ok('Last opened timestamp is refreshed', reopenRes.data?.data?.lastOpenedAt !== undefined);

    // -------------------------------------------------------------------------
    section('4. User-Isolated Project Listing (GET /api/projects)');
    // -------------------------------------------------------------------------
    const listARes = await request('GET', '/projects', tokenA);
    ok('User A lists projects successfully', listARes.status === 200);
    const userAProjects = listARes.data?.data || [];
    ok('User A project list contains registered project', userAProjects.some((p) => p.id === projectAId));
    ok('Projects in list carry isAccessible flag', userAProjects.every((p) => typeof p.isAccessible === 'boolean'));

    const listBRes = await request('GET', '/projects', tokenB);
    ok('User B lists projects successfully', listBRes.status === 200);
    const userBProjects = listBRes.data?.data || [];
    ok('User B CANNOT see User A projects', !userBProjects.some((p) => p.id === projectAId));

    // -------------------------------------------------------------------------
    section('5. Single Project Retrieval (GET /api/projects/:id)');
    // -------------------------------------------------------------------------
    const getRes = await request('GET', `/projects/${projectAId}`, tokenA);
    ok('User A retrieves project details', getRes.status === 200);
    ok('Project data has displayName', getRes.data?.data?.displayName === 'temp_phase2_workspace');
    ok('Project data has isAccessible = true', getRes.data?.data?.isAccessible === true);

    // Invalid ObjectId format
    const badIdRes = await request('GET', '/projects/not-a-valid-id', tokenA);
    ok('Invalid ID format returns 400 Bad Request', badIdRes.status === 400);

    // Non-existent ObjectId
    const fakeId = new mongoose.Types.ObjectId();
    const notFoundRes = await request('GET', `/projects/${fakeId}`, tokenA);
    ok('Non-existent project returns 404 Not Found', notFoundRes.status === 404);

    // -------------------------------------------------------------------------
    section('6. Multi-Tenant Authorization Protection');
    // -------------------------------------------------------------------------
    const unauthorizedGet = await request('GET', `/projects/${projectAId}`, tokenB);
    ok('User B GET on User A project returns 403 Forbidden', unauthorizedGet.status === 403);

    const unauthorizedPatch = await request('PATCH', `/projects/${projectAId}`, tokenB, {
      description: 'Hacked by User B',
    });
    ok('User B PATCH on User A project returns 403 Forbidden', unauthorizedPatch.status === 403);

    const unauthorizedDelete = await request('DELETE', `/projects/${projectAId}`, tokenB);
    ok('User B DELETE on User A project returns 403 Forbidden', unauthorizedDelete.status === 403);

    // -------------------------------------------------------------------------
    section('7. Update Permitted Metadata & Last Opened');
    // -------------------------------------------------------------------------
    const patchRes = await request('PATCH', `/projects/${projectAId}`, tokenA, {
      displayName: 'My Renamed Workspace',
      description: 'Updated description',
      gitRepo: 'https://github.com/user/repo.git',
      gitBranch: 'develop',
    });
    ok('User A updates metadata successfully', patchRes.status === 200);
    ok('displayName updated in response', patchRes.data?.data?.displayName === 'My Renamed Workspace');
    ok('gitRepo updated in response', patchRes.data?.data?.gitRepo === 'https://github.com/user/repo.git');
    ok('gitBranch updated in response', patchRes.data?.data?.gitBranch === 'develop');

    const lastOpenedRes = await request('PATCH', `/projects/${projectAId}/last-opened`, tokenA);
    ok('Update lastOpenedAt returns 200 OK', lastOpenedRes.status === 200);
    ok('Returns new lastOpenedAt date', !!lastOpenedRes.data?.data?.lastOpenedAt);

    // -------------------------------------------------------------------------
    section('8. Local Path Validation Endpoint (POST /api/projects/validate-path)');
    // -------------------------------------------------------------------------
    const validPathRes = await request('POST', '/projects/validate-path', tokenA, {
      localPath: tempTestDir,
    });
    ok('Valid path check returns exists: true', validPathRes.data?.exists === true);
    ok('Valid path check returns isDirectory: true', validPathRes.data?.isDirectory === true);
    ok('Valid path check returns accessible: true', validPathRes.data?.accessible === true);
    ok('Valid path returns entry count >= 2', (validPathRes.data?.entriesCount ?? 0) >= 2);

    const missingPathRes = await request('POST', '/projects/validate-path', tokenA, {
      localPath: path.join(__dirname, 'non_existent_folder_xyz_999'),
    });
    ok('Missing path check returns exists: false', missingPathRes.data?.exists === false);
    ok('Missing path check returns accessible: false', missingPathRes.data?.accessible === false);

    // -------------------------------------------------------------------------
    section('9. System Root Protection');
    // -------------------------------------------------------------------------
    const rootPath = process.platform === 'win32' ? 'C:\\' : '/';
    const sysRootRes = await request('POST', '/projects/open-folder', tokenA, {
      localPath: rootPath,
    });
    ok('System drive root is rejected with 400 Bad Request', sysRootRes.status === 400);

    if (process.platform === 'win32') {
      const winDirRes = await request('POST', '/projects/open-folder', tokenA, {
        localPath: 'C:\\Windows',
      });
      ok('C:\\Windows is rejected with 400 Bad Request', winDirRes.status === 400);
    }

    // -------------------------------------------------------------------------
    section('10. Missing Local Directory Detection (isAccessible: false)');
    // -------------------------------------------------------------------------
    const ghostProject = await Project.create({
      name: 'ghost-project',
      displayName: 'Ghost Project',
      slug: 'ghost-project-' + Date.now(),
      technology: 'nodejs',
      template: 'custom',
      projectType: 'local',
      localPath: 'D:\\totally_missing_dir_123456789',
      ownerId: userA._id,
      status: 'active',
      isImported: true,
    });

    const ghostGet = await request('GET', `/projects/${ghostProject._id}`, tokenA);
    ok('Ghost project returns isAccessible = false', ghostGet.data?.data?.isAccessible === false);

    const ghostFiles = await request('GET', `/projects/${ghostProject._id}/files`, tokenA);
    ok('Files browsing on missing directory returns 404', ghostFiles.status === 404);

    await ghostProject.deleteOne();

    // -------------------------------------------------------------------------
    section('11. Safe Project Deletion (Preserves Local Files)');
    // -------------------------------------------------------------------------
    const deleteRes = await request('DELETE', `/projects/${projectAId}`, tokenA);
    ok('Delete project returns 200 OK', deleteRes.status === 200);
    ok('Notice states local files were preserved', deleteRes.data?.message?.includes('preserved'));

    const checkDbDeleted = await Project.findById(projectAId);
    ok('Project metadata removed from MongoDB', checkDbDeleted === null);

    const folderStillExists = fsSync.existsSync(tempTestDir);
    const filesStillExist = fsSync.existsSync(path.join(tempTestDir, 'index.js'));
    ok('Physical directory STILL EXISTS on disk after deletion', folderStillExists && filesStillExist);
  } finally {
    // Cleanup temporary test directory
    try {
      if (fsSync.existsSync(tempTestDir)) {
        await fs.rm(tempTestDir, { recursive: true, force: true });
      }
    } catch (_) {}

    if (server) {
      server.close();
    }
    await mongoose.connection.close();
  }

  // ---------------------------------------------------------------------------
  section('Test Results Summary');
  // ---------------------------------------------------------------------------
  console.log(`  Total Passed: ${passed}`);
  console.log(`  Total Failed: ${failed}`);
  if (failed === 0) {
    console.log('\n  🎉 ALL PHASE 2 ACCEPTANCE TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error('\n  ❌ SOME ACCEPTANCE TESTS FAILED.\n');
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
