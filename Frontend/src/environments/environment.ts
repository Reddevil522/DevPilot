/**
 * Development Environment Configuration for DevPilot Frontend.
 *
 * Used during local development (`npm start` or `ng serve`).
 * Points to the local Node.js backend server and terminal WebSocket service.
 *
 * Architecture:
 * - Frontend communicates with the Node.js backend on http://localhost:5000/api.
 * - The Python AI service runs on http://localhost:8000 and is called only by the Node.js backend.
 * - Terminal sessions connect to ws://localhost:5000/api/terminal/ws.
 */
export const environment = {
  production: false,
  /**
   * Base REST API URL for the Node.js backend.
   * Individual services append their respective route paths (e.g. /auth, /projects, /ai).
   */
  apiUrl: 'http://localhost:5000/api',

  /**
   * WebSocket URL for the backend terminal service.
   */
  wsUrl: 'ws://localhost:5000/api/terminal/ws',
};
