/**
 * Production Environment Configuration for DevPilot Frontend.
 *
 * This file replaces `src/environments/environment.ts` during production builds (`ng build`).
 * Configured in `angular.json` under `projects.devpilot.architect.build.configurations.production.fileReplacements`.
 *
 * Architecture & Routing:
 * - Frontend communicates exclusively with the Node.js Express backend (HTTP + WebSockets).
 * - The Python AI service is an internal backend dependency proxied via `/api/ai`;
 *   no direct Python AI service endpoint or Ollama port is ever exposed to the browser.
 *
 * Configuration Strategy:
 * 1. Runtime Override: Checks `window.__DEVPILOT_CONFIG__` (e.g. from an inline script or `assets/config.js`).
 * 2. Build-Time Default: Falls back to the deployed production backend service URL on Render.
 * 3. Normalization: Automatically strips trailing slashes and ensures consistent `/api` prefixes,
 *    preventing duplicate `/api/api/...` segments or malformed WebSocket URLs.
 */

declare global {
  interface Window {
    __DEVPILOT_CONFIG__?: {
      apiUrl?: string;
      wsUrl?: string;
    };
  }
}

/**
 * Normalizes the API base URL:
 * - Trims whitespace and trailing slashes.
 * - Ensures single '/api' suffix (e.g., 'https://host' -> 'https://host/api', 'https://host/api/' -> 'https://host/api').
 * - Prevents duplicate '/api' path segments.
 */
function normalizeApiUrl(rawUrl?: string): string {
  // Replace with your actual Render backend URL or inject at runtime via window.__DEVPILOT_CONFIG__.apiUrl
  const fallback = 'https://devpilot-backend.onrender.com/api';
  if (!rawUrl || typeof rawUrl !== 'string') {
    return fallback;
  }
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return fallback;
  }
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

/**
 * Normalizes the Terminal WebSocket URL:
 * - Ensures 'wss://' scheme in production (or 'ws://' for local overrides).
 * - Trims whitespace and trailing slashes.
 * - Ensures terminal WebSocket endpoint path '/api/terminal/ws'.
 */
function normalizeWsUrl(rawWsUrl?: string, normalizedApiUrl?: string): string {
  const fallback = 'wss://devpilot-backend.onrender.com/api/terminal/ws';
  if (rawWsUrl && typeof rawWsUrl === 'string' && rawWsUrl.trim()) {
    const trimmed = rawWsUrl.trim().replace(/\/+$/, '');
    let wsTarget = trimmed.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    if (!wsTarget.startsWith('ws://') && !wsTarget.startsWith('wss://')) {
      wsTarget = `wss://${wsTarget.replace(/^\/+/, '')}`;
    }
    if (wsTarget.endsWith('/api/terminal/ws')) {
      return wsTarget;
    }
    if (wsTarget.endsWith('/api')) {
      return `${wsTarget}/terminal/ws`;
    }
    return `${wsTarget}/api/terminal/ws`;
  }

  // Derive from normalizedApiUrl if wsUrl was not explicitly provided
  if (normalizedApiUrl) {
    const wsTarget = normalizedApiUrl
      .trim()
      .replace(/\/+$/, '')
      .replace(/^http:\/\//i, 'ws://')
      .replace(/^https:\/\//i, 'wss://');
    return `${wsTarget}/terminal/ws`;
  }

  return fallback;
}

const runtimeConfig = (typeof window !== 'undefined' && window.__DEVPILOT_CONFIG__) || {};
const resolvedApiUrl = normalizeApiUrl(runtimeConfig.apiUrl);
const resolvedWsUrl = normalizeWsUrl(runtimeConfig.wsUrl, resolvedApiUrl);

export const environment = {
  production: true,
  apiUrl: resolvedApiUrl,
  wsUrl: resolvedWsUrl,
};
