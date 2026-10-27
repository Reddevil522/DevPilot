import { Injectable, signal, OnDestroy } from '@angular/core';
import { environment } from '../../../environments/environment';

export type TerminalStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'exited';

export interface TerminalSession {
  /** Client-side identifier (e.g., 'term-1') */
  id: string;
  /** Display title (e.g., 'PowerShell 1') */
  title: string;
  /** Associated project ID */
  projectId: string;
  /** Server-side sessionId (received after 'ready' message) */
  backendSessionId: string | null;
  /** Current connection / process status */
  status: TerminalStatus;
  /** Error message if in 'error' state */
  error: string | null;
  /** Exit code if process finished */
  exitCode: number | null;
  /** Exit signal if killed */
  exitSignal: string | null;
  /** Creation timestamp */
  createdAt: number;
}

interface InternalSessionState {
  session: TerminalSession;
  ws: WebSocket | null;
  pingTimer: any;
  outputListeners: Set<(data: string) => void>;
  exitListeners: Set<(exitCode: number | null, signal: string | null) => void>;
  cols: number;
  rows: number;
}

@Injectable({
  providedIn: 'root'
})
export class TerminalService implements OnDestroy {
  private counter = 0;
  private internalSessions = new Map<string, InternalSessionState>();

  /** Public list of active terminal sessions */
  readonly sessions = signal<TerminalSession[]>([]);

  /** Currently selected terminal session ID */
  readonly activeSessionId = signal<string | null>(null);

  /** Signal incremented whenever terminal tab focus is requested */
  readonly focusRequest = signal<number>(0);

  /**
   * Safely set the working directory of the active terminal session to the given path.
   */
  cdToDirectory(folderPath: string): void {
    const activeId = this.activeSessionId();
    if (!activeId || !folderPath) return;

    // Send Set-Location in PowerShell with quotes for safety
    this.sendInput(activeId, `Set-Location "${folderPath}"\r`);
    this.focusRequest.update(v => v + 1);
  }

  constructor() {}

  ngOnDestroy(): void {
    this.closeAllSessions();
  }

  /**
   * Determine the WebSocket URL for the terminal endpoint.
   */
  private getWsUrl(): string {
    if (environment.wsUrl) {
      return environment.wsUrl;
    }
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const hostname = window.location.hostname || 'localhost';
    // When running in Angular dev server (port 4200), default backend is on port 5000.
    const port = window.location.port === '4200' ? ':5000' : (window.location.port ? `:${window.location.port}` : '');
    return `${protocol}//${hostname}${port}/api/terminal/ws`;
  }

  /**
   * Update public sessions signal.
   */
  private syncSessions(): void {
    const list = Array.from(this.internalSessions.values()).map(s => ({ ...s.session }));
    this.sessions.set(list);
  }

  /**
   * Create and connect a new terminal session for the given project.
   *
   * @param projectId - MongoDB project ID
   * @param cols - Initial terminal columns (default: 80)
   * @param rows - Initial terminal rows (default: 24)
   * @returns Local session id
   */
  createSession(projectId: string, cols: number = 80, rows: number = 24): string {
    this.counter++;
    const id = `term-${Date.now()}-${this.counter}`;
    const title = `PowerShell ${this.internalSessions.size + 1}`;

    const session: TerminalSession = {
      id,
      title,
      projectId,
      backendSessionId: null,
      status: 'connecting',
      error: null,
      exitCode: null,
      exitSignal: null,
      createdAt: Date.now()
    };

    const state: InternalSessionState = {
      session,
      ws: null,
      pingTimer: null,
      outputListeners: new Set(),
      exitListeners: new Set(),
      cols,
      rows
    };

    this.internalSessions.set(id, state);
    this.syncSessions();
    this.activeSessionId.set(id);

    this.initWebSocket(state);
    return id;
  }

  /**
   * Reconnect or restart an existing session.
   */
  restartSession(id: string): void {
    const state = this.internalSessions.get(id);
    if (!state) return;

    this.cleanupWebSocket(state);
    state.session.status = 'connecting';
    state.session.error = null;
    state.session.exitCode = null;
    state.session.exitSignal = null;
    state.session.backendSessionId = null;
    this.syncSessions();

    this.initWebSocket(state);
  }

  /**
   * Initialize WebSocket for a session.
   */
  private initWebSocket(state: InternalSessionState): void {
    const { session } = state;
    const url = this.getWsUrl();

    try {
      const ws = new WebSocket(url);
      state.ws = ws;

      ws.onopen = () => {
        // Send create message on connection open
        const createMsg = {
          type: 'create',
          projectId: session.projectId,
          cols: state.cols,
          rows: state.rows
        };
        ws.send(JSON.stringify(createMsg));

        // Start ping keep-alive every 25 seconds
        state.pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, 25000);
      };

      ws.onmessage = (event: MessageEvent) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleServerMessage(state, msg);
        } catch (err) {
          console.warn('[TerminalService] Failed to parse message:', event.data);
        }
      };

      ws.onclose = (event: CloseEvent) => {
        clearInterval(state.pingTimer);
        state.pingTimer = null;

        if (event.code === 4401) {
          session.status = 'error';
          session.error = 'Authentication failed. Please log in to access the terminal.';
        } else if (session.status !== 'exited' && session.status !== 'disconnected') {
          if (event.wasClean) {
            session.status = 'disconnected';
          } else {
            session.status = 'error';
            session.error = session.error || 'Connection to terminal server lost.';
          }
        }
        this.syncSessions();
      };

      ws.onerror = () => {
        clearInterval(state.pingTimer);
        state.pingTimer = null;
        if (session.status === 'connecting') {
          session.status = 'error';
          session.error = 'Unable to connect to terminal backend. Please verify network connectivity and backend status.';
          this.syncSessions();
        }
      };
    } catch (e: any) {
      session.status = 'error';
      session.error = e.message || 'Failed to initialize WebSocket.';
      this.syncSessions();
    }
  }

  /**
   * Handle incoming protocol messages from the backend.
   */
  private handleServerMessage(state: InternalSessionState, msg: any): void {
    const { session } = state;

    switch (msg.type) {
      case 'ready':
        session.backendSessionId = msg.sessionId;
        session.status = 'connected';
        session.error = null;
        this.syncSessions();
        break;

      case 'output':
        if (msg.data) {
          state.outputListeners.forEach(listener => {
            try {
              listener(msg.data);
            } catch (err) {
              console.error('[TerminalService] Error in output listener:', err);
            }
          });
        }
        break;

      case 'exit':
        session.status = 'exited';
        session.exitCode = msg.exitCode ?? null;
        session.exitSignal = msg.signal ?? null;
        this.syncSessions();
        state.exitListeners.forEach(listener => {
          try {
            listener(session.exitCode, session.exitSignal);
          } catch (err) {
            console.error('[TerminalService] Error in exit listener:', err);
          }
        });
        break;

      case 'error':
        session.error = msg.message || 'Terminal error';
        if (session.status === 'connecting') {
          session.status = 'error';
        }
        this.syncSessions();
        break;

      case 'pong':
        // Heartbeat confirmed
        break;

      default:
        console.warn('[TerminalService] Unknown server message:', msg);
    }
  }

  /**
   * Send character / string input to the shell process.
   */
  sendInput(id: string, data: string): void {
    const state = this.internalSessions.get(id);
    if (!state || !state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (!state.session.backendSessionId) return;

    state.ws.send(JSON.stringify({
      type: 'input',
      sessionId: state.session.backendSessionId,
      data
    }));
  }

  /**
   * Resize the terminal session.
   */
  sendResize(id: string, cols: number, rows: number): void {
    const state = this.internalSessions.get(id);
    if (!state) return;
    state.cols = cols;
    state.rows = rows;

    if (!state.ws || state.ws.readyState !== WebSocket.OPEN) return;
    if (!state.session.backendSessionId) return;

    state.ws.send(JSON.stringify({
      type: 'resize',
      sessionId: state.session.backendSessionId,
      cols,
      rows
    }));
  }

  /**
   * Register a listener for terminal stdout/stderr data.
   * Returns an unregister function.
   */
  onOutput(id: string, listener: (data: string) => void): () => void {
    const state = this.internalSessions.get(id);
    if (!state) return () => {};
    state.outputListeners.add(listener);
    return () => {
      state.outputListeners.delete(listener);
    };
  }

  /**
   * Register a listener for terminal process exit.
   * Returns an unregister function.
   */
  onExit(id: string, listener: (exitCode: number | null, signal: string | null) => void): () => void {
    const state = this.internalSessions.get(id);
    if (!state) return () => {};
    state.exitListeners.add(listener);
    return () => {
      state.exitListeners.delete(listener);
    };
  }

  /**
   * Close and destroy a terminal session.
   */
  closeSession(id: string): void {
    const state = this.internalSessions.get(id);
    if (!state) return;

    if (state.ws && state.ws.readyState === WebSocket.OPEN && state.session.backendSessionId) {
      try {
        state.ws.send(JSON.stringify({
          type: 'close',
          sessionId: state.session.backendSessionId
        }));
      } catch (_) {}
    }

    this.cleanupWebSocket(state);
    this.internalSessions.delete(id);
    this.syncSessions();

    // Select another active session if the closed one was active
    if (this.activeSessionId() === id) {
      const remaining = Array.from(this.internalSessions.keys());
      this.activeSessionId.set(remaining.length > 0 ? remaining[remaining.length - 1] : null);
    }
  }

  /**
   * Close all active sessions (e.g., when navigating away or switching projects).
   */
  closeAllSessions(): void {
    for (const [id] of this.internalSessions) {
      this.closeSession(id);
    }
    this.internalSessions.clear();
    this.syncSessions();
    this.activeSessionId.set(null);
  }

  /**
   * Cleanup websocket connections and timers for a session state.
   */
  private cleanupWebSocket(state: InternalSessionState): void {
    if (state.pingTimer) {
      clearInterval(state.pingTimer);
      state.pingTimer = null;
    }
    if (state.ws) {
      try {
        state.ws.onopen = null;
        state.ws.onmessage = null;
        state.ws.onclose = null;
        state.ws.onerror = null;
        if (state.ws.readyState === WebSocket.OPEN || state.ws.readyState === WebSocket.CONNECTING) {
          state.ws.close();
        }
      } catch (_) {}
      state.ws = null;
    }
  }
}
