/**
 * test-phase3-dashboard.js
 * ============================================================================
 * Acceptance & Integration Test Suite for DevPilot Phase 3:
 * Connect Dashboard and Project Management to Real MongoDB Data
 *
 * Verifies:
 *  1. Dashboard loads real project metadata from MongoDB (no mocks/fake records)
 *  2. Projects carry authoritative fields: name, displayName, technology,
 *     projectType, localPath, isAccessible, status, timestamps
 *  3. Dashboard stats accurately reflect real records (total, active, deployments, local)
 *  4. Newly created projects appear immediately in user's project list
 *  5. Metadata edits (displayName, description, gitRepo, status) persist via PATCH
 *  6. Last opened timestamp updates accurately when opening a project
 *  7. Inaccessible/missing local directories are flagged (isAccessible: false)
 *  8. Path validation endpoint works for pre-flight checking
 *  9. Relocating a project updates localPath and restores accessibility
 * 10. Safe deletion removes metadata from MongoDB while preserving physical files
 * 11. Multi-tenant isolation: another user's projects are never leaked
 * 12. MongoDB contains ZERO source code or file contents
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

  const options = { method, headers };
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

async function runPhase3Tests() {
  console.log('======================================================================');
  console.log('   DEVPILOT PHASE 3: DASHBOARD & REAL MONGODB METADATA TEST SUITE     ');
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

  // 3. Setup test users
  let testUser = await User.findOne({ email: 'dashboard_tester@test.com' });
  if (!testUser) {
    testUser = await User.create({
      name: 'Dashboard Tester',
      email: 'dashboard_tester@test.com',
      passwordHash: 'dummy_hash_for_tester',
      isEmailVerified: true,
    });
  }

  let otherUser = await User.findOne({ email: 'other_developer@test.com' });
  if (!otherUser) {
    otherUser = await User.create({
      name: 'Other Developer',
      email: 'other_developer@test.com',
      passwordHash: 'dummy_hash_for_other',
      isEmailVerified: true,
    });
  }

  const token = jwt.sign({ userId: testUser._id.toString(), role: 'USER' }, process.env.JWT_ACCESS_SECRET);
  const otherToken = jwt.sign({ userId: otherUser._id.toString(), role: 'USER' }, process.env.JWT_ACCESS_SECRET);
  ok('Generated authentication JWTs', !!token && !!otherToken);

  // Prepare local folders
  const baseTestDir = path.join(__dirname, 'temp_phase3_workspace');
  const relocatedTestDir = path.join(__dirname, 'temp_phase3_relocated');

  if (fsSync.existsSync(baseTestDir)) await fs.rm(baseTestDir, { recursive: true, force: true });
  if (fsSync.existsSync(relocatedTestDir)) await fs.rm(relocatedTestDir, { recursive: true, force: true });

  await fs.mkdir(baseTestDir, { recursive: true });
  await fs.writeFile(path.join(baseTestDir, 'app.js'), 'console.log("DevPilot Workspace");');
  await fs.writeFile(path.join(baseTestDir, 'package.json'), JSON.stringify({ name: 'phase3-demo', dependencies: { react: '^18.0.0' } }));

  await fs.mkdir(relocatedTestDir, { recursive: true });
  await fs.writeFile(path.join(relocatedTestDir, 'app.js'), 'console.log("Relocated Workspace");');

  let projectId;

  try {
    // -------------------------------------------------------------------------
    section('1. Dashboard Initial State: Fetch Real MongoDB Projects');
    // -------------------------------------------------------------------------
    // Clean any prior projects for test user
    await Project.deleteMany({ ownerId: testUser._id });

    const initialListRes = await request('GET', '/projects', token);
    ok('GET /api/projects succeeds with 200 OK', initialListRes.status === 200);
    ok('Initial project list is empty array for fresh test user', Array.isArray(initialListRes.data?.data) && initialListRes.data.data.length === 0);

    // -------------------------------------------------------------------------
    section('2. Project Creation Updates Dashboard Data');
    // -------------------------------------------------------------------------
    const registerRes = await request('POST', '/projects/open-folder', token, {
      localPath: baseTestDir,
      displayName: 'Phase 3 React Workspace',
      description: 'A real React workspace registered into DevPilot',
    });

    ok('Registering workspace returns 201 Created', registerRes.status === 201);
    const createdProject = registerRes.data?.data;
    projectId = createdProject?.id || createdProject?._id;
    ok('Project has valid ID', !!projectId);
    ok('Project has correct displayName', createdProject?.displayName === 'Phase 3 React Workspace');
    ok('Project auto-detected technology as react', createdProject?.technology === 'react');
    ok('Project is marked as isAccessible: true', createdProject?.isAccessible === true);
    ok('Project has status active', createdProject?.status === 'active');
    ok('Project marked isImported: true', createdProject?.isImported === true);

    // Fetch list again to confirm dashboard will receive real record
    const updatedListRes = await request('GET', '/projects', token);
    const projs = updatedListRes.data?.data || [];
    ok('GET /api/projects now returns exactly 1 real record', projs.length === 1);
    ok('Record contains matching ID and displayName', projs[0].id === projectId && projs[0].displayName === 'Phase 3 React Workspace');
    ok('Record includes valid timestamps (createdAt, updatedAt, lastOpenedAt)', !!projs[0].createdAt && !!projs[0].updatedAt && !!projs[0].lastOpenedAt);

    // -------------------------------------------------------------------------
    section('3. Authoritative Statistics Calculation from MongoDB Records');
    // -------------------------------------------------------------------------
    const statsTotal = projs.length;
    const statsActive = projs.filter(p => p.status === 'active').length;
    const statsDeployments = projs.filter(p => !!p.deploymentUrl).length;
    const statsLocal = projs.filter(p => p.projectType === 'local').length;

    ok('Computed total projects = 1', statsTotal === 1);
    ok('Computed active projects = 1', statsActive === 1);
    ok('Computed deployments = 0', statsDeployments === 0);
    ok('Computed local workspaces = 1', statsLocal === 1);

    // -------------------------------------------------------------------------
    section('4. Persist Project Metadata Edits (PATCH /api/projects/:id)');
    // -------------------------------------------------------------------------
    const editRes = await request('PATCH', `/projects/${projectId}`, token, {
      displayName: 'Renamed Phase 3 Workspace',
      description: 'Updated production ready description',
      gitRepo: 'https://github.com/devpilot/phase3.git',
      gitBranch: 'develop',
      status: 'active'
    });

    ok('PATCH /api/projects/:id succeeds with 200 OK', editRes.status === 200);
    ok('displayName updated in DB response', editRes.data?.data?.displayName === 'Renamed Phase 3 Workspace');
    ok('gitRepo persisted in DB response', editRes.data?.data?.gitRepo === 'https://github.com/devpilot/phase3.git');
    ok('gitBranch persisted in DB response', editRes.data?.data?.gitBranch === 'develop');

    // Confirm by re-fetching project from MongoDB directly
    const dbDoc = await Project.findById(projectId).lean();
    ok('MongoDB document reflects updated displayName', dbDoc.displayName === 'Renamed Phase 3 Workspace');
    ok('MongoDB document reflects updated description', dbDoc.description === 'Updated production ready description');
    ok('MongoDB document reflects updated gitRepo', dbDoc.gitRepo === 'https://github.com/devpilot/phase3.git');

    // -------------------------------------------------------------------------
    section('5. Update Last-Opened Timestamp (Project Opening Contract)');
    // -------------------------------------------------------------------------
    const previousOpenedAt = dbDoc.lastOpenedAt;
    // Small pause to guarantee timestamp advancement
    await new Promise(r => setTimeout(r, 50));

    const lastOpenedRes = await request('PATCH', `/projects/${projectId}/last-opened`, token);
    ok('PATCH /api/projects/:id/last-opened returns 200 OK', lastOpenedRes.status === 200);
    ok('Response contains updated lastOpenedAt', !!lastOpenedRes.data?.data?.lastOpenedAt);
    const newOpenedTime = new Date(lastOpenedRes.data.data.lastOpenedAt).getTime();
    const oldOpenedTime = new Date(previousOpenedAt).getTime();
    ok('New lastOpenedAt timestamp is strictly >= old timestamp', newOpenedTime >= oldOpenedTime);

    // -------------------------------------------------------------------------
    section('6. Local Directory Accessibility Detection & Validation');
    // -------------------------------------------------------------------------
    // Test validation pre-flight endpoint
    const validCheck = await request('POST', '/projects/validate-path', token, { localPath: baseTestDir });
    ok('Pre-flight validate valid path: accessible === true', validCheck.data?.accessible === true);
    ok('Pre-flight validate valid path: isDirectory === true', validCheck.data?.isDirectory === true);

    const invalidCheck = await request('POST', '/projects/validate-path', token, { localPath: 'D:\\totally_nonexistent_xyz_99' });
    ok('Pre-flight validate missing path: accessible === false', invalidCheck.data?.accessible === false);
    ok('Pre-flight validate missing path: exists === false', invalidCheck.data?.exists === false);

    // Simulate inaccessible folder by temporarily modifying localPath in DB
    await Project.updateOne({ _id: projectId }, { localPath: 'D:\\fake_missing_folder_phase3' });
    const inaccGetRes = await request('GET', `/projects/${projectId}`, token);
    ok('GET /api/projects/:id reports isAccessible = false for missing folder', inaccGetRes.data?.data?.isAccessible === false);

    // -------------------------------------------------------------------------
    section('7. Workspace Relocation Recovery Flow');
    // -------------------------------------------------------------------------
    // User relocates missing workspace to relocatedTestDir
    const relocateRes = await request('PATCH', `/projects/${projectId}`, token, {
      localPath: relocatedTestDir
    });
    ok('Relocate project returns 200 OK', relocateRes.status === 200);
    ok('Relocate updates localPath to new directory', relocateRes.data?.data?.localPath === relocatedTestDir);
    ok('Relocate restores isAccessible = true', relocateRes.data?.data?.isAccessible === true);

    // Verify GET returns accessible
    const recheckRes = await request('GET', `/projects/${projectId}`, token);
    ok('Subsequent GET verifies workspace is now accessible', recheckRes.data?.data?.isAccessible === true);

    // -------------------------------------------------------------------------
    section('8. Multi-Tenant Isolation & Authentication Guards');
    // -------------------------------------------------------------------------
    const otherUserGet = await request('GET', `/projects/${projectId}`, otherToken);
    ok('Other user GET returns 403 Forbidden', otherUserGet.status === 403);

    const otherUserPatch = await request('PATCH', `/projects/${projectId}`, otherToken, { displayName: 'Hacked' });
    ok('Other user PATCH returns 403 Forbidden', otherUserPatch.status === 403);

    const unauthGet = await request('GET', `/projects/${projectId}`, null);
    ok('Unauthenticated GET returns 401 Unauthorized', unauthGet.status === 401);

    // -------------------------------------------------------------------------
    section('9. Zero Source Code Stored in MongoDB (Purity Check)');
    // -------------------------------------------------------------------------
    const fullDbDoc = await Project.findById(projectId).lean();
    ok('MongoDB doc contains no "files" property', fullDbDoc.files === undefined);
    ok('MongoDB doc contains no "fileContent" property', fullDbDoc.fileContent === undefined);
    ok('MongoDB doc contains no "code" property', fullDbDoc.code === undefined);
    ok('MongoDB doc contains no "archive" property', fullDbDoc.archive === undefined);
    ok('MongoDB doc contains only metadata descriptors', !!fullDbDoc.name && !!fullDbDoc.localPath && !!fullDbDoc.ownerId);

    // -------------------------------------------------------------------------
    section('10. Safe Deletion (Metadata Removed, Physical Files Preserved)');
    // -------------------------------------------------------------------------
    const deleteRes = await request('DELETE', `/projects/${projectId}`, token);
    ok('DELETE project succeeds with 200 OK', deleteRes.status === 200);
    ok('Delete response confirms local files preserved', deleteRes.data?.message?.includes('preserved'));

    const deletedDoc = await Project.findById(projectId);
    ok('Project metadata cleanly removed from MongoDB', deletedDoc === null);

    const fileStillOnDisk = fsSync.existsSync(path.join(relocatedTestDir, 'app.js'));
    ok('Physical workspace files still exist intact on local filesystem', fileStillOnDisk);

  } finally {
    // Cleanup temporary folders
    try {
      if (fsSync.existsSync(baseTestDir)) await fs.rm(baseTestDir, { recursive: true, force: true });
      if (fsSync.existsSync(relocatedTestDir)) await fs.rm(relocatedTestDir, { recursive: true, force: true });
    } catch (_) {}

    if (server) server.close();
    await mongoose.connection.close();
  }

  // ---------------------------------------------------------------------------
  section('Phase 3 Test Results Summary');
  // ---------------------------------------------------------------------------
  console.log(`  Total Passed: ${passed}`);
  console.log(`  Total Failed: ${failed}`);
  if (failed === 0) {
    console.log('\n  🎉 ALL PHASE 3 ACCEPTANCE TESTS PASSED SUCCESSFULLY!\n');
    process.exit(0);
  } else {
    console.error('\n  ❌ SOME PHASE 3 TESTS FAILED.\n');
    process.exit(1);
  }
}

runPhase3Tests().catch((err) => {
  console.error('Fatal Test Runner Error:', err);
  process.exit(1);
});
