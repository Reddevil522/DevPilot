const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const BASE_URL = 'http://127.0.0.1:5000/api';
const JWT_SECRET = process.env.JWT_ACCESS_SECRET;

const USER_A_ID = '6ac72c13ffced9ac266dd4fa'; // Gopal kumar
const USER_B_ID = '6ac72c13ffced9ac266dd4fb'; // Attacker / Other user
const PROJECT_A_ID = '6ac77b189ca5e55cba2e8871'; // Project 'xyz'
const PROJECT_A_PATH = 'D:\\Projects\\xyz';

const tokenA = jwt.sign({ userId: USER_A_ID, role: 'USER' }, JWT_SECRET);
const tokenB = jwt.sign({ userId: USER_B_ID, role: 'USER' }, JWT_SECRET);

async function runExplorerTestSuite() {
  console.log('================================================================');
  console.log('DevPilot Explorer: Full End-to-End Filesystem Operations Tests');
  console.log('================================================================\n');

  const results = [];

  const headersA = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenA}`
  };

  const headersB = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${tokenB}`
  };

  // 1. Create a real folder on disk
  try {
    console.log('Test 1: Create real folder on disk...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs/folder`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ path: 'test_explorer_dir' })
    });
    const data = await res.json();
    const diskPath = path.join(PROJECT_A_PATH, 'test_explorer_dir');
    const diskExists = fs.existsSync(diskPath) && fs.statSync(diskPath).isDirectory();

    if (res.status === 201 && data.success && diskExists) {
      console.log('  [PASS] Folder created on disk:', diskPath);
      results.push({ id: 1, name: 'Create Folder on Disk', pass: true });
    } else {
      console.log('  [FAIL] res status:', res.status, data, 'diskExists:', diskExists);
      results.push({ id: 1, name: 'Create Folder on Disk', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 1, name: 'Create Folder on Disk', pass: false });
  }

  // 2. Reject duplicate folder creation
  try {
    console.log('Test 2: Reject duplicate folder creation (409 Conflict)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs/folder`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({ path: 'test_explorer_dir' })
    });
    const data = await res.json();
    if (res.status === 409 && data.success === false && data.message.includes('already exists')) {
      console.log('  [PASS] Correctly rejected duplicate folder with 409:', data.message);
      results.push({ id: 2, name: 'Reject Duplicate Folder (409)', pass: true });
    } else {
      console.log('  [FAIL] res status:', res.status, data);
      results.push({ id: 2, name: 'Reject Duplicate Folder (409)', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 2, name: 'Reject Duplicate Folder (409)', pass: false });
  }

  // 3. Create real file on disk
  try {
    console.log('Test 3: Create real file on disk inside folder...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        path: 'test_explorer_dir/auth.service.ts',
        content: 'export class AuthService { login() { return true; } }'
      })
    });
    const data = await res.json();
    const diskPath = path.join(PROJECT_A_PATH, 'test_explorer_dir', 'auth.service.ts');
    const diskExists = fs.existsSync(diskPath);
    const content = diskExists ? fs.readFileSync(diskPath, 'utf8') : '';

    if (res.status === 201 && data.success && diskExists && content.includes('AuthService')) {
      console.log('  [PASS] File physically created on disk with content:', diskPath);
      results.push({ id: 3, name: 'Create Real File on Disk', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data, 'diskExists:', diskExists);
      results.push({ id: 3, name: 'Create Real File on Disk', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 3, name: 'Create Real File on Disk', pass: false });
  }

  // 4. Reject duplicate file creation
  try {
    console.log('Test 4: Reject duplicate file creation (409 Conflict)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        path: 'test_explorer_dir/auth.service.ts',
        content: 'duplicate content'
      })
    });
    const data = await res.json();
    if (res.status === 409 && data.success === false && data.message.includes('already exists')) {
      console.log('  [PASS] Correctly rejected duplicate file with 409:', data.message);
      results.push({ id: 4, name: 'Reject Duplicate File (409)', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 4, name: 'Reject Duplicate File (409)', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 4, name: 'Reject Duplicate File (409)', pass: false });
  }

  // 5. Rename file on disk
  try {
    console.log('Test 5: Rename real file on disk...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs/rename`, {
      method: 'PATCH',
      headers: headersA,
      body: JSON.stringify({
        oldPath: 'test_explorer_dir/auth.service.ts',
        newPath: 'test_explorer_dir/authentication.service.ts'
      })
    });
    const data = await res.json();
    const oldDisk = path.join(PROJECT_A_PATH, 'test_explorer_dir', 'auth.service.ts');
    const newDisk = path.join(PROJECT_A_PATH, 'test_explorer_dir', 'authentication.service.ts');
    const oldExists = fs.existsSync(oldDisk);
    const newExists = fs.existsSync(newDisk);
    const newContent = newExists ? fs.readFileSync(newDisk, 'utf8') : '';

    if (res.status === 200 && data.success && !oldExists && newExists && newContent.includes('AuthService')) {
      console.log('  [PASS] File renamed: old path disappeared, new path exists with intact content');
      results.push({ id: 5, name: 'Rename File on Disk', pass: true });
    } else {
      console.log('  [FAIL] oldExists:', oldExists, 'newExists:', newExists, data);
      results.push({ id: 5, name: 'Rename File on Disk', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 5, name: 'Rename File on Disk', pass: false });
  }

  // 6. Rename folder recursively on disk
  try {
    console.log('Test 6: Rename folder recursively on disk...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs/rename`, {
      method: 'PATCH',
      headers: headersA,
      body: JSON.stringify({
        oldPath: 'test_explorer_dir',
        newPath: 'test_explorer_dir_renamed'
      })
    });
    const data = await res.json();
    const oldDir = path.join(PROJECT_A_PATH, 'test_explorer_dir');
    const newDir = path.join(PROJECT_A_PATH, 'test_explorer_dir_renamed');
    const childFile = path.join(newDir, 'authentication.service.ts');
    const oldExists = fs.existsSync(oldDir);
    const newExists = fs.existsSync(newDir);
    const childExists = fs.existsSync(childFile);

    if (res.status === 200 && data.success && !oldExists && newExists && childExists) {
      console.log('  [PASS] Folder renamed: all child files remain intact at new location');
      results.push({ id: 6, name: 'Rename Folder Recursively', pass: true });
    } else {
      console.log('  [FAIL] oldExists:', oldExists, 'newExists:', newExists, 'childExists:', childExists);
      results.push({ id: 6, name: 'Rename Folder Recursively', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 6, name: 'Rename Folder Recursively', pass: false });
  }

  // 7. Delete file on disk
  try {
    console.log('Test 7: Delete file on disk...');
    const res = await fetch(
      `${BASE_URL}/projects/${PROJECT_A_ID}/fs?path=${encodeURIComponent('test_explorer_dir_renamed/authentication.service.ts')}&isFolder=false`,
      {
        method: 'DELETE',
        headers: headersA
      }
    );
    const data = await res.json();
    const diskPath = path.join(PROJECT_A_PATH, 'test_explorer_dir_renamed', 'authentication.service.ts');
    const exists = fs.existsSync(diskPath);

    if (res.status === 200 && data.success && !exists) {
      console.log('  [PASS] File successfully deleted from disk');
      results.push({ id: 7, name: 'Delete File from Disk', pass: true });
    } else {
      console.log('  [FAIL] exists:', exists, data);
      results.push({ id: 7, name: 'Delete File from Disk', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 7, name: 'Delete File from Disk', pass: false });
  }

  // 8. Delete folder on disk recursively
  try {
    console.log('Test 8: Delete folder recursively on disk...');
    // Create dummy file inside to verify recursive deletion
    fs.writeFileSync(path.join(PROJECT_A_PATH, 'test_explorer_dir_renamed', 'dummy.txt'), 'hello');
    const res = await fetch(
      `${BASE_URL}/projects/${PROJECT_A_ID}/fs?path=${encodeURIComponent('test_explorer_dir_renamed')}&isFolder=true`,
      {
        method: 'DELETE',
        headers: headersA
      }
    );
    const data = await res.json();
    const diskPath = path.join(PROJECT_A_PATH, 'test_explorer_dir_renamed');
    const exists = fs.existsSync(diskPath);

    if (res.status === 200 && data.success && !exists) {
      console.log('  [PASS] Folder and all contents removed from disk');
      results.push({ id: 8, name: 'Delete Folder Recursively', pass: true });
    } else {
      console.log('  [FAIL] exists:', exists, data);
      results.push({ id: 8, name: 'Delete Folder Recursively', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 8, name: 'Delete Folder Recursively', pass: false });
  }

  // 9. Path traversal rejection
  try {
    console.log('Test 9: Reject path traversal (../ or ..\\)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        path: '../escape.txt',
        content: 'malicious'
      })
    });
    const data = await res.json();
    if (res.status >= 400 && data.success === false && (data.message.includes('traversal') || data.message.includes('denied'))) {
      console.log('  [PASS] Path traversal safely rejected:', data.message);
      results.push({ id: 9, name: 'Reject Path Traversal', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 9, name: 'Reject Path Traversal', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 9, name: 'Reject Path Traversal', pass: false });
  }

  // 10. Absolute client path rejection
  try {
    console.log('Test 10: Reject absolute client paths (C:\\... or D:\\...)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        path: 'C:\\Windows\\System32\\test.txt',
        content: 'test'
      })
    });
    const data = await res.json();
    if (res.status >= 400 && data.success === false && data.message.includes('Absolute paths')) {
      console.log('  [PASS] Absolute paths safely rejected:', data.message);
      results.push({ id: 10, name: 'Reject Absolute Paths', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 10, name: 'Reject Absolute Paths', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 10, name: 'Reject Absolute Paths', pass: false });
  }

  // 11. Windows reserved device names rejection
  try {
    console.log('Test 11: Reject Windows reserved device names (CON, AUX, NUL, COM1, etc.)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        path: 'nul.txt',
        content: 'test'
      })
    });
    const data = await res.json();
    if (res.status >= 400 && data.success === false && data.message.includes('reserved Windows device name')) {
      console.log('  [PASS] Reserved device name safely rejected:', data.message);
      results.push({ id: 11, name: 'Reject Windows Reserved Names', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 11, name: 'Reject Windows Reserved Names', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 11, name: 'Reject Windows Reserved Names', pass: false });
  }

  // 12. Invalid characters rejection
  try {
    console.log('Test 12: Reject invalid characters (< > : " | ? *)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersA,
      body: JSON.stringify({
        path: 'bad<name>.ts',
        content: 'test'
      })
    });
    const data = await res.json();
    if (res.status >= 400 && data.success === false && data.message.includes('invalid characters')) {
      console.log('  [PASS] Invalid characters safely rejected:', data.message);
      results.push({ id: 12, name: 'Reject Invalid Characters', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 12, name: 'Reject Invalid Characters', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 12, name: 'Reject Invalid Characters', pass: false });
  }

  // 13. Project root deletion protection
  try {
    console.log('Test 13: Prevent accidental project-root deletion...');
    const res1 = await fetch(
      `${BASE_URL}/projects/${PROJECT_A_ID}/fs?path=&isFolder=true`,
      { method: 'DELETE', headers: headersA }
    );
    const data1 = await res1.json();

    const res2 = await fetch(
      `${BASE_URL}/projects/${PROJECT_A_ID}/fs?path=.&isFolder=true`,
      { method: 'DELETE', headers: headersA }
    );
    const data2 = await res2.json();

    if (res1.status === 400 && data1.message.includes('Cannot delete project root') &&
        res2.status === 400 && data2.message.includes('Cannot delete project root')) {
      console.log('  [PASS] Root deletion safely prevented:', data1.message);
      results.push({ id: 13, name: 'Project Root Deletion Guard', pass: true });
    } else {
      console.log('  [FAIL] res1:', res1.status, data1, 'res2:', res2.status, data2);
      results.push({ id: 13, name: 'Project Root Deletion Guard', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 13, name: 'Project Root Deletion Guard', pass: false });
  }

  // 14. Unauthorized user access rejection
  try {
    console.log('Test 14: Reject unauthorized user access (403 Forbidden)...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/fs`, {
      method: 'POST',
      headers: headersB, // Attacker token
      body: JSON.stringify({
        path: 'hacked.txt',
        content: 'pwned'
      })
    });
    const data = await res.json();
    if (res.status === 403 && data.success === false && data.message.includes('Not authorized')) {
      console.log('  [PASS] Unauthorized access safely rejected with 403:', data.message);
      results.push({ id: 14, name: 'Unauthorized User Guard (403)', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 14, name: 'Unauthorized User Guard (403)', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 14, name: 'Unauthorized User Guard (403)', pass: false });
  }

  // 15. Verify Shallow Tree Directory Reading
  try {
    console.log('Test 15: Verify shallow tree file listing...');
    const res = await fetch(`${BASE_URL}/projects/${PROJECT_A_ID}/files`, {
      method: 'GET',
      headers: headersA
    });
    const data = await res.json();
    if (res.status === 200 && data.success && Array.isArray(data.data) && data.data.length > 0) {
      console.log(`  [PASS] Successfully retrieved project shallow tree (${data.data.length} root entries)`);
      results.push({ id: 15, name: 'Shallow Tree Retrieval', pass: true });
    } else {
      console.log('  [FAIL] status:', res.status, data);
      results.push({ id: 15, name: 'Shallow Tree Retrieval', pass: false });
    }
  } catch (err) {
    console.log('  [FAIL] Error:', err.message);
    results.push({ id: 15, name: 'Shallow Tree Retrieval', pass: false });
  }

  console.log('\n================================================================');
  console.log(`SUMMARY: ${results.filter(r => r.pass).length} / ${results.length} TESTS PASSED`);
  console.log('================================================================');

  const allPassed = results.every(r => r.pass);
  if (!allPassed) {
    process.exit(1);
  }
}

runExplorerTestSuite().catch(err => {
  console.error('Test suite error:', err);
  process.exit(1);
});
