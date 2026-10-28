const path = require('path');
const fs = require('fs');
const os = require('os');
const jwt = require('jsonwebtoken');
const mongoose = require('mongoose');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE_URL = 'http://127.0.0.1:5000/api';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET || 'your_super_secret_access_token_key_here';

const USER_A_ID = new mongoose.Types.ObjectId('6ac72c13ffced9ac266dd4fa'); // Gopal kumar
const USER_B_ID = new mongoose.Types.ObjectId('6ac72c13ffced9ac266dd4fb'); // Other user

const tokenA = jwt.sign({ userId: USER_A_ID.toString(), role: 'USER' }, JWT_SECRET);
const tokenB = jwt.sign({ userId: USER_B_ID.toString(), role: 'USER' }, JWT_SECRET);

async function runTestSuite() {
  await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/devpilot');

  const User = require('./src/models/user.model');
  const Project = require('./src/models/project.model');
  const Document = require('./src/models/document.model');

  console.log('================================================================');
  console.log('DevPilot: Document Generation Backend Test Suite');
  console.log('================================================================\n');

  // Ensure test users exist
  await User.findByIdAndUpdate(
    USER_A_ID,
    { name: 'Gopal Kumar', email: 'gopal_doc_test@test.com', role: 'USER' },
    { upsert: true, returnDocument: 'after' }
  );
  await User.findByIdAndUpdate(
    USER_B_ID,
    { name: 'Other User', email: 'other_doc_test@test.com', role: 'USER' },
    { upsert: true, returnDocument: 'after' }
  );

  // Set up a temporary local project directory in OS temp (outside nodemon watch directory)
  const tempProjectDir = path.join(os.tmpdir(), 'devpilot_test_doc_proj_' + Date.now());
  if (!fs.existsSync(tempProjectDir)) {
    fs.mkdirSync(tempProjectDir, { recursive: true });
  }
  fs.writeFileSync(path.join(tempProjectDir, 'package.json'), JSON.stringify({ name: 'test-doc-app', version: '1.0.0' }, null, 2));

  // Find or create test project for User A
  let projectA = await Project.findOne({ ownerId: USER_A_ID, slug: 'doc-test-project' });
  if (!projectA) {
    projectA = await Project.create({
      name: 'Doc Test Project',
      slug: 'doc-test-project',
      technology: 'nodejs',
      template: 'blank',
      projectType: 'local',
      localPath: tempProjectDir,
      ownerId: USER_A_ID,
    });
  } else {
    projectA.localPath = tempProjectDir;
    await projectA.save();
  }

  // Brief pause for network stability
  await new Promise(r => setTimeout(r, 600));

  const projectId = projectA._id.toString();
  const results = [];
  let generatedDocId = null;

  // TEST 1: Unauthenticated request to /types
  try {
    process.stdout.write('Test 1: Unauthenticated access rejected (401)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/types`);
    const data = await res.json();
    if (res.status === 401 && data.success === false) {
      console.log('PASS');
      results.push({ id: 1, name: 'Unauthenticated access rejected (401)', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: 1, name: 'Unauthenticated access rejected (401)', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`, err.cause);
    results.push({ id: 1, name: 'Unauthenticated access rejected (401)', pass: false });
  }

  // TEST 2: Authenticated request to /types
  try {
    process.stdout.write('Test 2: GET /api/ai/docs/types returns supported options... ');
    const res = await fetch(`${BASE_URL}/ai/docs/types`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const data = await res.json();
    if (res.status === 200 && data.success && Array.isArray(data.data.docTypes) && data.data.docTypes.length >= 5) {
      console.log(`PASS (${data.data.docTypes.length} types)`);
      results.push({ id: 2, name: 'GET /api/ai/docs/types returns supported options', pass: true });
    } else {
      console.log('FAIL');
      results.push({ id: 2, name: 'GET /api/ai/docs/types returns supported options', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 2, name: 'GET /api/ai/docs/types returns supported options', pass: false });
  }

  // TEST 3: Validation - Missing projectId
  try {
    process.stdout.write('Test 3: Validation: Missing projectId rejected (400)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ docType: 'readme' })
    });
    const data = await res.json();
    if (res.status === 400 && data.success === false) {
      console.log('PASS');
      results.push({ id: 3, name: 'Validation: Missing projectId rejected', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: 3, name: 'Validation: Missing projectId rejected', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 3, name: 'Validation: Missing projectId rejected', pass: false });
  }

  // TEST 4: Validation - Invalid docType
  try {
    process.stdout.write('Test 4: Validation: Invalid docType rejected (400)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ projectId, docType: 'invalid_type_123' })
    });
    const data = await res.json();
    if (res.status === 400 && data.success === false) {
      console.log('PASS');
      results.push({ id: 4, name: 'Validation: Invalid docType rejected', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: 4, name: 'Validation: Invalid docType rejected', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 4, name: 'Validation: Invalid docType rejected', pass: false });
  }

  // TEST 5: Security - Path Traversal Prevention
  try {
    process.stdout.write('Test 5: Security: Path traversal in targetPath rejected (400)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({ projectId, targetPath: '../../etc/shadow' })
    });
    const data = await res.json();
    if (res.status === 400 && data.success === false) {
      console.log('PASS');
      results.push({ id: 5, name: 'Security: Path traversal in targetPath rejected', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: 5, name: 'Security: Path traversal in targetPath rejected', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 5, name: 'Security: Path traversal in targetPath rejected', pass: false });
  }

  // TEST 6: Security - Access Control: User B cannot generate for User A's project
  try {
    process.stdout.write('Test 6: Security: Non-owner access to project rejected (403)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenB}`
      },
      body: JSON.stringify({ projectId, docType: 'readme' })
    });
    const data = await res.json();
    if (res.status === 403 && data.success === false) {
      console.log('PASS');
      results.push({ id: 6, name: 'Security: Non-owner project access rejected', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: 6, name: 'Security: Non-owner project access rejected', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 6, name: 'Security: Non-owner project access rejected', pass: false });
  }

  // TEST 7: Document Generation via POST /api/ai/docs/generate
  // Note: if Python AI service is offline, we test graceful error (503) or live success (200)
  try {
    process.stdout.write('Test 7: Document Generation request handling... ');
    const res = await fetch(`${BASE_URL}/ai/docs/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        projectId,
        docType: 'readme',
        title: 'README.md',
        instructions: 'Include project summary and setup instructions.',
        length: 'short',
        saveToHistory: true,
      })
    });
    const data = await res.json();
    if (res.status === 200 && data.success && data.data && data.data.content) {
      generatedDocId = data.data.documentId;
      console.log(`PASS (Live AI generated document: ID ${generatedDocId})`);
      results.push({ id: 7, name: 'Document Generation request handling', pass: true });
    } else if (res.status === 503 && data.code === 'AI_SERVICE_UNREACHABLE') {
      console.log('PASS (Graceful 503 AI_SERVICE_UNREACHABLE handled properly)');
      results.push({ id: 7, name: 'Document Generation request handling (Graceful 503)', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status}, Message: ${data.message})`);
      results.push({ id: 7, name: 'Document Generation request handling', pass: false });
    }

    // Ensure downstream tests (GET, PUT, EXPORT, DELETE) have a valid document
    if (!generatedDocId) {
      const createdDoc = await Document.create({
        projectId: projectA._id,
        userId: USER_A_ID,
        title: 'README.md',
        docType: 'readme',
        filePath: 'README.md',
        content: '# Test Doc App\n\nFull stack test app overview.',
        format: 'markdown',
        status: 'completed',
        version: 1,
      });
      generatedDocId = createdDoc._id.toString();
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 7, name: 'Document Generation request handling', pass: false });
  }

  // TEST 8: Document History via GET /api/ai/docs/project/:projectId
  try {
    process.stdout.write('Test 8: GET /api/ai/docs/project/:projectId returns history... ');
    const res = await fetch(`${BASE_URL}/ai/docs/project/${projectId}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const data = await res.json();
    if (res.status === 200 && data.success && Array.isArray(data.data) && data.data.length >= 1) {
      console.log(`PASS (${data.data.length} docs found)`);
      results.push({ id: 8, name: 'GET document history by project', pass: true });
    } else {
      console.log('FAIL');
      results.push({ id: 8, name: 'GET document history by project', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 8, name: 'GET document history by project', pass: false });
  }

  // TEST 9: Document Retrieval via GET /api/ai/docs/:id
  try {
    process.stdout.write('Test 9: GET /api/ai/docs/:id retrieves specific document... ');
    const res = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const data = await res.json();
    if (res.status === 200 && data.success && data.data.title === 'README.md') {
      console.log('PASS');
      results.push({ id: 9, name: 'GET document by ID', pass: true });
    } else {
      console.log('FAIL');
      results.push({ id: 9, name: 'GET document by ID', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 9, name: 'GET document by ID', pass: false });
  }

  // TEST 10: Security - User B cannot read User A's document
  try {
    process.stdout.write('Test 10: Security: Cross-user document access rejected (403)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}`, {
      headers: { 'Authorization': `Bearer ${tokenB}` }
    });
    const data = await res.json();
    if (res.status === 403 && data.success === false) {
      console.log('PASS');
      results.push({ id: 10, name: 'Cross-user document access rejected (403)', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: 10, name: 'Cross-user document access rejected (403)', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 10, name: 'Cross-user document access rejected (403)', pass: false });
  }

  // TEST 11: Document Update via PUT /api/ai/docs/:id
  try {
    process.stdout.write('Test 11: PUT /api/ai/docs/:id updates editable document... ');
    const res = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        title: 'README_UPDATED.md',
        content: '# Updated Title\n\nManually revised content.',
      })
    });
    const data = await res.json();
    if (res.status === 200 && data.success && data.data.title === 'README_UPDATED.md' && data.data.version >= 2) {
      console.log(`PASS (Version updated to ${data.data.version})`);
      results.push({ id: 11, name: 'PUT document updates content and increments version', pass: true });
    } else {
      console.log('FAIL');
      results.push({ id: 11, name: 'PUT document updates content and increments version', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 11, name: 'PUT document updates content and increments version', pass: false });
  }

  // TEST 11B: Revision validation via POST /api/ai/docs/revise
  try {
    process.stdout.write('Test 11b: POST /api/ai/docs/revise rejects missing revisionInstruction (400)... ');
    const res = await fetch(`${BASE_URL}/ai/docs/revise`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        currentContent: '# Current Content',
        // missing revisionInstruction
      })
    });
    const data = await res.json();
    if (res.status === 400 && data.success === false) {
      console.log('PASS');
      results.push({ id: '11b', name: 'POST /api/ai/docs/revise rejects missing revisionInstruction', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: '11b', name: 'POST /api/ai/docs/revise rejects missing revisionInstruction', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: '11b', name: 'POST /api/ai/docs/revise rejects missing revisionInstruction', pass: false });
  }

  // TEST 11C: Backward compatibility - POST /api/ai/generate-docs
  try {
    process.stdout.write('Test 11c: Backward compatible POST /api/ai/generate-docs rejects invalid input (400)... ');
    const res = await fetch(`${BASE_URL}/ai/generate-docs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        // missing projectId
        docType: 'readme'
      })
    });
    const data = await res.json();
    if (res.status === 400 && data.success === false) {
      console.log('PASS');
      results.push({ id: '11c', name: 'Backward compatible POST /api/ai/generate-docs endpoint', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status})`);
      results.push({ id: '11c', name: 'Backward compatible POST /api/ai/generate-docs endpoint', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: '11c', name: 'Backward compatible POST /api/ai/generate-docs endpoint', pass: false });
  }

  // TEST 12: Save to Project Filesystem via POST /api/ai/docs/save
  try {
    process.stdout.write('Test 12: POST /api/ai/docs/save with saveToProject writes to disk... ');
    const diskContent = '# Project Setup\n\nWritten directly to filesystem.';
    const res = await fetch(`${BASE_URL}/ai/docs/save`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        projectId,
        title: 'SETUP.md',
        docType: 'readme',
        filePath: 'SETUP.md',
        content: diskContent,
        saveToProject: true,
      })
    });
    const data = await res.json();
    const diskFilePath = path.join(tempProjectDir, 'SETUP.md');
    const fileExistsOnDisk = fs.existsSync(diskFilePath) && fs.readFileSync(diskFilePath, 'utf8') === diskContent;

    if (res.status === 201 && data.success && fileExistsOnDisk) {
      console.log('PASS (File verified on local filesystem)');
      results.push({ id: 12, name: 'Save document writes to local filesystem', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status}, onDisk: ${fileExistsOnDisk})`);
      results.push({ id: 12, name: 'Save document writes to local filesystem', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 12, name: 'Save document writes to local filesystem', pass: false });
  }

  // TEST 13: Export document as Markdown via GET /api/ai/docs/:id/export?format=markdown
  try {
    process.stdout.write('Test 13: GET /api/ai/docs/:id/export exports Markdown file... ');
    const res = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}/export?format=markdown`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const disposition = res.headers.get('content-disposition') || '';
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (res.status === 200 && disposition.includes('.md') && contentType.includes('markdown') && text.length > 0) {
      console.log('PASS');
      results.push({ id: 13, name: 'Export document as Markdown with headers', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status}, type: ${contentType})`);
      results.push({ id: 13, name: 'Export document as Markdown with headers', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 13, name: 'Export document as Markdown with headers', pass: false });
  }

  // TEST 14: Export document as HTML via GET /api/ai/docs/:id/export?format=html
  try {
    process.stdout.write('Test 14: GET /api/ai/docs/:id/export exports HTML file... ');
    const res = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}/export?format=html`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const disposition = res.headers.get('content-disposition') || '';
    const contentType = res.headers.get('content-type') || '';
    const text = await res.text();

    if (res.status === 200 && disposition.includes('.html') && contentType.includes('html') && text.includes('<!DOCTYPE html>')) {
      console.log('PASS');
      results.push({ id: 14, name: 'Export document as HTML with document structure', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status}, type: ${contentType})`);
      results.push({ id: 14, name: 'Export document as HTML with document structure', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 14, name: 'Export document as HTML with document structure', pass: false });
  }

  // TEST 15: Direct export on-the-fly via POST /api/ai/docs/export
  try {
    process.stdout.write('Test 15: POST /api/ai/docs/export exports on-the-fly content... ');
    const res = await fetch(`${BASE_URL}/ai/docs/export`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${tokenA}`
      },
      body: JSON.stringify({
        title: 'Quick_Export',
        content: '# Quick Export Content',
        format: 'markdown'
      })
    });
    const disposition = res.headers.get('content-disposition') || '';
    const text = await res.text();

    if (res.status === 200 && disposition.includes('Quick_Export.md') && text.includes('# Quick Export Content')) {
      console.log('PASS');
      results.push({ id: 15, name: 'Direct export on-the-fly content', pass: true });
    } else {
      console.log('FAIL');
      results.push({ id: 15, name: 'Direct export on-the-fly content', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 15, name: 'Direct export on-the-fly content', pass: false });
  }

  // TEST 16: Document Deletion via DELETE /api/ai/docs/:id
  try {
    process.stdout.write('Test 16: DELETE /api/ai/docs/:id deletes document... ');
    const res = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}`, {
      method: 'DELETE',
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });
    const data = await res.json();

    const checkRes = await fetch(`${BASE_URL}/ai/docs/${generatedDocId}`, {
      headers: { 'Authorization': `Bearer ${tokenA}` }
    });

    if (res.status === 200 && data.success && checkRes.status === 404) {
      console.log('PASS (Deleted and verified 404)');
      results.push({ id: 16, name: 'DELETE document by ID', pass: true });
    } else {
      console.log(`FAIL (Status: ${res.status}, checkStatus: ${checkRes.status})`);
      results.push({ id: 16, name: 'DELETE document by ID', pass: false });
    }
  } catch (err) {
    console.log(`FAIL: ${err.message}`);
    results.push({ id: 16, name: 'DELETE document by ID', pass: false });
  }

  // Cleanup test files
  try {
    fs.rmSync(tempProjectDir, { recursive: true, force: true });
    await Project.deleteOne({ _id: projectA._id });
  } catch {}

  console.log('\n================================================================');
  const passed = results.filter(r => r.pass).length;
  console.log(`Test Results: ${passed} / ${results.length} PASSED`);
  console.log('================================================================\n');

  await mongoose.disconnect();
  process.exit(passed === results.length ? 0 : 1);
}

runTestSuite().catch(err => {
  console.error('Test suite runner crashed:', err);
  process.exit(1);
});
