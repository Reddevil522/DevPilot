const fs = require('fs');
const path = require('path');

// Resolve file paths
const envPath = path.join(__dirname, '..', '.env');
const targetPath = path.join(__dirname, '..', 'public', 'assets', 'config.js');

let apiUrl = process.env.DEVPILOT_API_URL || process.env.API_URL;
let wsUrl = process.env.DEVPILOT_WS_URL || process.env.WS_URL;

// Parse .env if it exists
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const match = trimmed.match(/^([^=]+)=(.*)$/);
    if (match) {
      const key = match[1].trim();
      let value = match[2].trim().replace(/^['"]|['"]$/g, '');
      if (key === 'DEVPILOT_API_URL' && (!process.env.DEVPILOT_API_URL || !apiUrl)) {
        apiUrl = value;
      }
      if (key === 'DEVPILOT_WS_URL' && (!process.env.DEVPILOT_WS_URL || !wsUrl)) {
        wsUrl = value;
      }
    }
  }
}

// Normalize URLs
apiUrl = (apiUrl || 'http://localhost:5000/api').trim().replace(/\/+$/, '');
if (!apiUrl.endsWith('/api')) {
  apiUrl = `${apiUrl}/api`;
}

if (!wsUrl || typeof wsUrl !== 'string' || !wsUrl.trim()) {
  const wsScheme = apiUrl.startsWith('https') ? 'wss://' : 'ws://';
  const host = apiUrl.replace(/^https?:\/\//i, '').replace(/\/api$/, '');
  wsUrl = `${wsScheme}${host}/api/terminal/ws`;
} else {
  let trimmedWs = wsUrl.trim().replace(/\/+$/, '');
  trimmedWs = trimmedWs.replace(/^ws:https:\/\//i, 'wss://').replace(/^ws:http:\/\//i, 'ws://');
  let wsTarget = trimmedWs.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
  if (!wsTarget.startsWith('ws://') && !wsTarget.startsWith('wss://')) {
    wsTarget = apiUrl.startsWith('https') ? `wss://${wsTarget.replace(/^\/+/, '')}` : `ws://${wsTarget.replace(/^\/+/, '')}`;
  }
  if (wsTarget.endsWith('/api/terminal/ws')) {
    wsUrl = wsTarget;
  } else if (wsTarget.endsWith('/api')) {
    wsUrl = `${wsTarget}/terminal/ws`;
  } else {
    wsUrl = `${wsTarget}/api/terminal/ws`;
  }
}

const targetContent = `/**
 * DevPilot Active Runtime Configuration
 * Automatically synchronized from .env via scripts/set-env.js
 * Generated: ${new Date().toISOString()}
 */
window.__DEVPILOT_CONFIG__ = {
  apiUrl: '${apiUrl}',
  wsUrl: '${wsUrl}',
};
`;

fs.mkdirSync(path.dirname(targetPath), { recursive: true });
fs.writeFileSync(targetPath, targetContent, 'utf8');
console.log(`[DevPilot] Synchronized .env -> public/assets/config.js (apiUrl: ${apiUrl}, wsUrl: ${wsUrl})`);

// Also update dist output if present
const distTargetPath = path.join(__dirname, '..', 'dist', 'devpilot', 'browser', 'assets', 'config.js');
if (fs.existsSync(path.dirname(distTargetPath))) {
  fs.writeFileSync(distTargetPath, targetContent, 'utf8');
  console.log(`[DevPilot] Synchronized .env -> dist/devpilot/browser/assets/config.js`);
}
