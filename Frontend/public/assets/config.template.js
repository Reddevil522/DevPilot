/**
 * DevPilot Frontend Runtime Configuration Template
 *
 * Use this file when you want to change backend endpoints without rebuilding the Angular application.
 *
 * HOW TO USE:
 * 1. Copy this file to `Frontend/public/assets/config.js`
 * 2. Replace the placeholder URLs below with your deployed Render Web Service URLs.
 * 3. Add `<script src="assets/config.js"></script>` to `Frontend/src/index.html` inside `<head>`.
 *
 * Note: If this file is omitted, Angular automatically uses the values defined in
 * `src/environments/environment.prod.ts`.
 */
window.__DEVPILOT_CONFIG__ = {
  // Your deployed Node.js backend URL (HTTPS)
  // Example: 'https://devpilot-backend.onrender.com/api'
  apiUrl: 'https://devpilot-backend.onrender.com/api',

  // Your deployed Node.js terminal WebSocket URL (WSS)
  // Example: 'wss://devpilot-backend.onrender.com/api/terminal/ws'
  wsUrl: 'wss://devpilot-backend.onrender.com/api/terminal/ws',
};
