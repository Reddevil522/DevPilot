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
declare global {
  interface Window {
    __DEVPILOT_CONFIG__?: {
      apiUrl?: string;
      wsUrl?: string;
    };
  }
}

function normalizeApiUrl(rawUrl?: string): string {
  const fallback = 'http://localhost:5000/api';
  if (!rawUrl || typeof rawUrl !== 'string') {
    return fallback;
  }
  const trimmed = rawUrl.trim().replace(/\/+$/, '');
  if (!trimmed) {
    return fallback;
  }
  return trimmed.endsWith('/api') ? trimmed : `${trimmed}/api`;
}

function normalizeWsUrl(rawWsUrl?: string, normalizedApiUrl?: string): string {
  const fallback = 'ws://localhost:5000/api/terminal/ws';
  if (rawWsUrl && typeof rawWsUrl === 'string' && rawWsUrl.trim()) {
    let trimmed = rawWsUrl.trim().replace(/\/+$/, '');
    trimmed = trimmed.replace(/^ws:https:\/\//i, 'wss://').replace(/^ws:http:\/\//i, 'ws://');
    let wsTarget = trimmed.replace(/^http:\/\//i, 'ws://').replace(/^https:\/\//i, 'wss://');
    if (!wsTarget.startsWith('ws://') && !wsTarget.startsWith('wss://')) {
      wsTarget = (normalizedApiUrl && normalizedApiUrl.startsWith('https'))
        ? `wss://${wsTarget.replace(/^\/+/, '')}`
        : `ws://${wsTarget.replace(/^\/+/, '')}`;
    }
    if (wsTarget.endsWith('/api/terminal/ws')) {
      return wsTarget;
    }
    if (wsTarget.endsWith('/api')) {
      return `${wsTarget}/terminal/ws`;
    }
    return `${wsTarget}/api/terminal/ws`;
  }

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

export const environment = {
  production: false,
  get apiUrl(): string {
    const config = (typeof window !== 'undefined' && window.__DEVPILOT_CONFIG__) || {};
    return normalizeApiUrl(config.apiUrl);
  },
  get wsUrl(): string {
    const config = (typeof window !== 'undefined' && window.__DEVPILOT_CONFIG__) || {};
    return normalizeWsUrl(config.wsUrl, this.apiUrl);
  },
};
