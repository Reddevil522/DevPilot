/**
 * test-phase5-python-ai-integration.js
 * ============================================================================
 * Phase 5/6 Integration Test Suite:
 * - Node.js Express as Trusted Gateway
 * - Python AI Service Integration & Error Propagation
 * - Project Context Construction & Sensitive File Exclusion
 * - Approval-Based File Change Pipeline (Proposal -> Diff -> User Approval -> Atomic Write)
 * - Conflict Detection (409 STALE_DIFF_CONFLICT)
 * - Safe Explorer & Editor State Synchronization Contracts
 * - MongoDB Conversation Persistence
 * ============================================================================
 */

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const path = require('path');
const fs = require('fs');
const fsPromises = require('fs').promises;
const http = require('http');
const crypto = require('crypto');
const mongoose = require('mongoose');
const jwt = require('jsonwebtoken');

const app = require('./src/app');
const AiService = require('./src/services/ai.service');
const AiContextService = require('./src/services/ai-context.service');
const AiFileApplyService = require('./src/services/ai-file-apply.service');
const FileSystemService = require('./src/services/filesystem.service');
const Project = require('./src/models/project.model');
const User = require('./src/models/user.model');
const Conversation = require('./src/models/conversation.model');

const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'your_super_secret_access_token_key_here';

let passed = 0;
let failed = 0;

function ok(name, condition, detail = '') {
  if (condition) {
    passed++;
    console.log(`  [PASS] ${name}${detail ? ` (${detail})` : ''}`);
  } else {
    failed++;
    console.error(`  [FAIL] ${name}${detail ? ` (${detail})` : ''}`);
  }
}

async function runTests() {
  console.log('================================================================');
  console.log('DevPilot AI Phase 5/6: Python AI & Local Files Integration Tests');
  console.log('================================================================\n');

  // 1. Connect MongoDB
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/devpilot');

  // 2. Setup mock temp project directory
  const tempProjectDir = path.join(__dirname, 'scratch', `test_proj_${Date.now()}`);
  await fsPromises.mkdir(path.join(tempProjectDir, 'src'), { recursive: true });
  await fsPromises.writeFile(path.join(tempProjectDir, 'src', 'index.js'), 'console.log("initial version");\n', 'utf8');
  await fsPromises.writeFile(path.join(tempProjectDir, 'package.json'), '{"name":"test-app","version":"1.0.0"}', 'utf8');
  await fsPromises.writeFile(path.join(tempProjectDir, '.env'), 'DATABASE_PASSWORD=super_secret_password\n', 'utf8');
  await fsPromises.writeFile(path.join(tempProjectDir, 'secret.key'), 'PRIVATE_KEY_DATA\n', 'utf8');

  // 3. Setup test users and project in MongoDB
  const userAId = new mongoose.Types.ObjectId();
  const userBId = new mongoose.Types.ObjectId();

  await User.create({
    _id: userAId,
    name: 'Authorized Dev',
    email: `dev_${Date.now()}@test.com`,
    passwordHash: 'dummy_hash',
    role: 'USER'
  });

  await User.create({
    _id: userBId,
    name: 'Attacker / Other',
    email: `other_${Date.now()}@test.com`,
    passwordHash: 'dummy_hash',
    role: 'USER'
  });

  const testProject = await Project.create({
    name: 'Phase 5 Test App',
    slug: `phase-5-test-app-${Date.now()}`,
    technology: 'nodejs',
    template: 'blank',
    projectType: 'local',
    localPath: tempProjectDir,
    ownerId: userAId
  });

  const tokenA = jwt.sign({ userId: userAId.toString(), role: 'USER' }, JWT_SECRET);
  const tokenB = jwt.sign({ userId: userBId.toString(), role: 'USER' }, JWT_SECRET);

  // 4. Start Express Server
  const server = http.createServer(app);
  await new Promise(resolve => server.listen(0, resolve));
  const port = server.address().port;
  const baseUrl = `http://127.0.0.1:${port}/api`;

  // 5. Start Mock Python AI Service
  let mockPythonStatus = 200;
  let mockPythonResponse = {};
  const mockPythonServer = http.createServer((req, res) => {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      res.writeHead(mockPythonStatus, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(mockPythonResponse));
    });
  });
  await new Promise(resolve => mockPythonServer.listen(0, resolve));
  const pythonPort = mockPythonServer.address().port;
  process.env.PYTHON_AI_URL = `http://127.0.0.1:${pythonPort}`;

  console.log(`Node.js Gateway running on port ${port}`);
  console.log(`Mock Python AI Service running on port ${pythonPort}\n`);

  try {
    // ------------------------------------------------------------------------
    // TEST SECTION 1: Context Construction & Sensitive File Filtering
    // ------------------------------------------------------------------------
    console.log('--- TEST SECTION 1: Project Context & Security Filtering ---');
    const { contextData, contextString } = await AiContextService.buildStructuredContext({
      project: testProject,
      activeFilePath: 'src/index.js',
      selectedCode: 'console.log("initial version");',
      userPrompt: 'refactor this function',
      errorContext: ''
    });

    ok('Context includes project metadata', contextData.project_name === 'Phase 5 Test App');
    ok('Context includes active file path', contextData.active_file?.path === 'src/index.js');
    ok('Active file has sha256 original_hash', typeof contextData.active_file?.original_hash === 'string' && contextData.active_file.original_hash.length === 64);
    ok('Sensitive file .env excluded from authorized files', !contextData.authorized_files.includes('.env'));
    ok('Sensitive file secret.key excluded from authorized files', !contextData.authorized_files.includes('secret.key'));
    ok('Sensitive content not leaked into context string', !contextString.includes('super_secret_password'));

    // ------------------------------------------------------------------------
    // TEST SECTION 2: Node.js Gateway Authentication & Project Authorization
    // ------------------------------------------------------------------------
    console.log('\n--- TEST SECTION 2: Gateway Authentication & Authorization ---');
    // 2.1 Unauthenticated request rejected
    const unauthRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: 'Hello' })
    });
    ok('Unauthenticated chat request rejected with 401', unauthRes.status === 401);

    // 2.2 User B cannot access Project A
    const crossProjRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({
        message: 'Hello',
        projectId: testProject._id.toString()
      })
    });
    ok('Unauthorized project access rejected with 403', crossProjRes.status === 403);

    // 2.3 Empty message rejected
    const emptyMsgRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        message: '   ',
        projectId: testProject._id.toString()
      })
    });
    ok('Empty message rejected with 400', emptyMsgRes.status === 400);

    // ------------------------------------------------------------------------
    // TEST SECTION 3: Python AI Service Error Handling & Propagation
    // ------------------------------------------------------------------------
    console.log('\n--- TEST SECTION 3: Python AI Service Error Handling ---');
    // 3.1 Python service down (ECONNREFUSED)
    process.env.PYTHON_AI_URL = 'http://127.0.0.1:59998'; // Dead port
    const pyDownRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ message: 'Hello' })
    });
    const pyDownBody = await pyDownRes.json();
    ok('Python service downtime returns 503 AI_SERVICE_UNREACHABLE', pyDownRes.status === 503 && pyDownBody.code === 'AI_SERVICE_UNREACHABLE');

    // Restore working Python URL
    process.env.PYTHON_AI_URL = `http://127.0.0.1:${pythonPort}`;

    // 3.2 Ollama daemon unreachable (Python returns 503)
    mockPythonStatus = 503;
    mockPythonResponse = {
      code: 'OLLAMA_UNREACHABLE',
      message: 'Cannot reach local Ollama daemon at http://localhost:11434. Please ensure Ollama is installed and running.'
    };
    const ollamaDownRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ message: 'Hello' })
    });
    const ollamaDownBody = await ollamaDownRes.json();
    ok('Ollama downtime propagates 503 OLLAMA_UNREACHABLE', ollamaDownRes.status === 503 && ollamaDownBody.code === 'OLLAMA_UNREACHABLE');

    // 3.3 Model missing (Python returns 404)
    mockPythonStatus = 404;
    mockPythonResponse = {
      code: 'MODEL_NOT_FOUND',
      message: "Model 'qwen2.5-coder:3b' is not installed in local Ollama."
    };
    const modelMissingRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ message: 'Hello' })
    });
    const modelMissingBody = await modelMissingRes.json();
    ok('Missing model propagates 404 MODEL_NOT_FOUND', modelMissingRes.status === 404 && modelMissingBody.code === 'MODEL_NOT_FOUND');

    // ------------------------------------------------------------------------
    // TEST SECTION 4: Proposal Enrichment & Pre-Approval Safety
    // ------------------------------------------------------------------------
    console.log('\n--- TEST SECTION 4: Proposal Enrichment & Disk Immutability ---');
    mockPythonStatus = 200;
    mockPythonResponse = {
      content: "I have refactored `src/index.js` and created a helper in `src/helper.js`.",
      operation: 'chat',
      proposal: {
        summary: 'Refactor index and add helper',
        explanation: 'Extracted utility function to helper.js',
        changes: [
          {
            path: 'src/index.js',
            operation: 'edit',
            content: 'const { greet } = require("./helper");\ngreet();\n',
            explanation: 'Use greet from helper'
          },
          {
            path: 'src/helper.js',
            operation: 'create',
            content: 'function greet() { console.log("Hello from helper!"); }\nmodule.exports = { greet };\n',
            explanation: 'Helper utility'
          },
          {
            path: '../../etc/shadow', // Path traversal attack in proposal
            operation: 'create',
            content: 'malicious',
            explanation: 'attack'
          },
          {
            path: '.env', // Sensitive file attack in proposal
            operation: 'edit',
            content: 'OVERWRITTEN',
            explanation: 'attack'
          }
        ]
      },
      model: 'qwen2.5-coder:3b'
    };

    const chatRes = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        message: 'Refactor my code',
        projectId: testProject._id.toString(),
        activeFilePath: 'src/index.js'
      })
    });

    const chatData = await chatRes.json();
    ok('Chat request succeeded with status 200', chatRes.status === 200 && chatData.success);
    ok('Conversation ID returned', typeof chatData.conversationId === 'string');

    const proposal = chatData.message?.proposal;
    ok('Proposal is attached to assistant message', !!proposal);
    ok('Proposal status is "pending"', proposal.status === 'pending');
    ok('Malicious path traversal was stripped from proposal', !proposal.changes.some(c => c.path.includes('shadow')));
    ok('Malicious .env modification was stripped from proposal', !proposal.changes.some(c => c.path === '.env'));
    ok('Valid changes count is exactly 2', proposal.changes.length === 2);

    const editChange = proposal.changes.find(c => c.path === 'src/index.js');
    const createChange = proposal.changes.find(c => c.path === 'src/helper.js');

    ok('Edit change has originalContent populated from disk', editChange.originalContent === 'console.log("initial version");\n');
    ok('Edit change has accurate originalHash computed', editChange.originalHash === crypto.createHash('sha256').update('console.log("initial version");\n').digest('hex'));
    ok('Create change has empty originalHash and originalContent', createChange.originalContent === '' && createChange.originalHash === '');

    // Critical Requirement: Verify disk files are UNCHANGED before approval!
    const diskIndexBeforeApproval = await fsPromises.readFile(path.join(tempProjectDir, 'src', 'index.js'), 'utf8');
    ok('Files on disk remain UNCHANGED merely because proposal was generated', diskIndexBeforeApproval === 'console.log("initial version");\n');
    ok('New file was NOT created merely because proposal was generated', !fs.existsSync(path.join(tempProjectDir, 'src', 'helper.js')));

    // ------------------------------------------------------------------------
    // TEST SECTION 5: Approval Flow, Conflict Detection & Atomic Writes
    // ------------------------------------------------------------------------
    console.log('\n--- TEST SECTION 5: Approval Flow, Conflict Detection & Atomic Writes ---');
    const conversationId = chatData.conversationId;
    const messageId = chatData.message.id;

    // 5.1 Unauthorized user cannot apply changes
    const attackerApplyRes = await fetch(`${baseUrl}/ai/apply-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({
        conversationId,
        messageId,
        projectId: testProject._id.toString()
      })
    });
    ok('Unauthorized user cannot apply changes (403)', attackerApplyRes.status === 403);

    // 5.2 Conflict detection: Modify src/index.js on disk before applying
    await fsPromises.writeFile(path.join(tempProjectDir, 'src', 'index.js'), 'console.log("external edit occurred!");\n', 'utf8');

    const conflictApplyRes = await fetch(`${baseUrl}/ai/apply-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        conversationId,
        messageId,
        projectId: testProject._id.toString()
      })
    });
    const conflictData = await conflictApplyRes.json();
    ok('Conflict detected when disk content changed after preview (409 STALE_DIFF_CONFLICT)', conflictApplyRes.status === 409 && conflictData.code === 'STALE_DIFF_CONFLICT');

    // 5.3 Restore original content to resolve conflict
    await fsPromises.writeFile(path.join(tempProjectDir, 'src', 'index.js'), 'console.log("initial version");\n', 'utf8');

    // 5.4 Legitimate user approves changes
    const validApplyRes = await fetch(`${baseUrl}/ai/apply-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        conversationId,
        messageId,
        projectId: testProject._id.toString()
      })
    });
    const validApplyData = await validApplyRes.json();
    ok('Applying approved changes succeeds with 200', validApplyRes.status === 200 && validApplyData.success);
    ok('Reported applied files contains both files', validApplyData.appliedFiles.includes('src/index.js') && validApplyData.appliedFiles.includes('src/helper.js'));

    // 5.5 Verify disk contents are updated
    const updatedIndexContent = await fsPromises.readFile(path.join(tempProjectDir, 'src', 'index.js'), 'utf8');
    const createdHelperContent = await fsPromises.readFile(path.join(tempProjectDir, 'src', 'helper.js'), 'utf8');
    ok('Disk file src/index.js reflects applied AI change', updatedIndexContent === 'const { greet } = require("./helper");\ngreet();\n');
    ok('Disk file src/helper.js was created with AI content', createdHelperContent === 'function greet() { console.log("Hello from helper!"); }\nmodule.exports = { greet };\n');

    // 5.6 Verify MongoDB conversation proposal status updated to 'applied'
    const updatedConv = await Conversation.findById(conversationId);
    const targetMsg = updatedConv.messages.find(m => m.id === messageId);
    ok('MongoDB proposal status updated to "applied"', targetMsg?.proposal?.status === 'applied');

    // 5.7 Duplicate apply rejected
    const duplicateApplyRes = await fetch(`${baseUrl}/ai/apply-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        conversationId,
        messageId,
        projectId: testProject._id.toString()
      })
    });
    ok('Duplicate apply attempt rejected with 400', duplicateApplyRes.status === 400);

    // ------------------------------------------------------------------------
    // TEST SECTION 6: Rejection Flow
    // ------------------------------------------------------------------------
    console.log('\n--- TEST SECTION 6: Rejection Flow ---');
    // Generate second proposal
    const chat2Res = await fetch(`${baseUrl}/ai/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        message: 'Second refactor proposal',
        projectId: testProject._id.toString(),
        conversationId
      })
    });
    const chat2Data = await chat2Res.json();
    const message2Id = chat2Data.message.id;

    // Reject it
    const rejectRes = await fetch(`${baseUrl}/ai/reject-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        conversationId,
        messageId: message2Id
      })
    });
    const rejectData = await rejectRes.json();
    ok('Rejecting proposal succeeds with 200', rejectRes.status === 200 && rejectData.success);

    const convAfterReject = await Conversation.findById(conversationId);
    const rejectedMsg = convAfterReject.messages.find(m => m.id === message2Id);
    ok('MongoDB proposal status updated to "rejected"', rejectedMsg?.proposal?.status === 'rejected');

    // Attempting to apply a rejected proposal is forbidden
    const applyRejectedRes = await fetch(`${baseUrl}/ai/apply-changes`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        conversationId,
        messageId: message2Id,
        projectId: testProject._id.toString()
      })
    });
    ok('Applying previously rejected proposal rejected with 400', applyRejectedRes.status === 400);

    // ------------------------------------------------------------------------
    // TEST SECTION 7: Documentation Generation Endpoint
    // ------------------------------------------------------------------------
    console.log('\n--- TEST SECTION 7: Documentation Generation Endpoint ---');
    mockPythonStatus = 200;
    mockPythonResponse = {
      doc_type: 'readme',
      content: '# Phase 5 Test App\n\nGenerated documentation from Python AI.\n',
      proposal: {
        summary: 'Add README.md documentation',
        explanation: 'Generated comprehensive README',
        changes: [
          {
            path: 'README.md',
            operation: 'create',
            content: '# Phase 5 Test App\n\nGenerated documentation from Python AI.\n',
            explanation: 'README doc'
          }
        ]
      },
      model: 'qwen2.5-coder:3b'
    };

    const docRes = await fetch(`${baseUrl}/ai/generate-docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        projectId: testProject._id.toString(),
        docType: 'readme'
      })
    });
    const docData = await docRes.json();
    ok('Generate docs endpoint returns 200', docRes.status === 200 && docData.success);
    ok('Docs response contains real generated Markdown content', docData.data?.content?.includes('Phase 5 Test App'));
    ok('Docs response contains structured proposal', docData.data?.proposal?.changes?.[0]?.path === 'README.md');

  } finally {
    // Cleanup
    server.close();
    mockPythonServer.close();
    await Project.findByIdAndDelete(testProject._id);
    await User.findByIdAndDelete(userAId);
    await User.findByIdAndDelete(userBId);
    await Conversation.deleteMany({ userId: { $in: [userAId, userBId] } });
    await fsPromises.rm(tempProjectDir, { recursive: true, force: true }).catch(() => {});
    await mongoose.disconnect();
  }

  console.log('\n================================================================');
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log('================================================================');

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error('Test suite uncaught error:', err);
  process.exit(1);
});
