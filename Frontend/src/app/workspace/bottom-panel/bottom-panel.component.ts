import {
  Component,
  signal,
  inject,
  computed,
  ViewChild,
  ElementRef,
  AfterViewInit,
  OnDestroy,
  effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { WorkspaceService } from '../../core/services/workspace.service';
import { TerminalService, TerminalSession } from '../../core/services/terminal.service';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type PanelTab = 'terminal' | 'problems' | 'output' | 'debug';

interface MountedTerminal {
  sessionId: string;
  term: Terminal;
  fitAddon: FitAddon;
  element: HTMLElement;
  resizeObserver: ResizeObserver;
  unbindOutput: () => void;
  unbindExit: () => void;
}

const DEVPILOT_TERMINAL_THEME = {
  background: '#0a0d18',
  foreground: '#f2f3f9',
  cursor: '#6366f1',
  cursorAccent: '#0a0d18',
  selectionBackground: 'rgba(99, 102, 241, 0.35)',
  selectionForeground: '#ffffff',
  black: '#090c14',
  red: '#f87171',
  green: '#4ade80',
  yellow: '#fbbf24',
  blue: '#60a5fa',
  magenta: '#c084fc',
  cyan: '#5eead4',
  white: '#f2f3f9',
  brightBlack: '#4b5563',
  brightRed: '#fca5a5',
  brightGreen: '#86efac',
  brightYellow: '#fde047',
  brightBlue: '#93c5fd',
  brightMagenta: '#d8b4fe',
  brightCyan: '#99f6e4',
  brightWhite: '#ffffff'
};

@Component({
  selector: 'app-bottom-panel',
  standalone: true,
  imports: [CommonModule, SharedIconsModule],
  templateUrl: './bottom-panel.component.html',
  styleUrl: './bottom-panel.component.css'
})
export class BottomPanelComponent implements AfterViewInit, OnDestroy {
  private workspaceService = inject(WorkspaceService);
  readonly terminalService = inject(TerminalService);

  @ViewChild('terminalContainer') terminalContainerRef?: ElementRef<HTMLDivElement>;

  readonly activeProject = this.workspaceService.activeProject;
  readonly activeTab = signal<PanelTab>('terminal');
  readonly tabs: PanelTab[] = ['terminal', 'problems', 'output', 'debug'];

  readonly sessions = this.terminalService.sessions;
  readonly activeSessionId = this.terminalService.activeSessionId;

  readonly currentSession = computed<TerminalSession | null>(() => {
    const id = this.activeSessionId();
    if (!id) return null;
    return this.sessions().find(s => s.id === id) || null;
  });

  private mountedTerminals = new Map<string, MountedTerminal>();
  private initialized = false;
  private currentProjectId: string | null = null;

  constructor() {
    // Reactively watch for project changes
    effect(() => {
      const proj = this.activeProject();
      const projId = proj ? (proj.id || proj.projectId || null) : null;

      if (projId !== this.currentProjectId) {
        this.currentProjectId = projId;
        if (this.initialized) {
          this.handleProjectChange(projId);
        }
      }
    }, { allowSignalWrites: true });

    // Reactively watch for activeSessionId changes to switch visible xterm
    effect(() => {
      const activeId = this.activeSessionId();
      if (this.initialized && activeId) {
        this.updateVisibleTerminal(activeId);
      }
    });

    // Reactively watch for external terminal focus requests
    effect(() => {
      const req = this.terminalService.focusRequest();
      if (req > 0 && this.initialized) {
        this.activeTab.set('terminal');
        setTimeout(() => {
          this.fitActiveTerminal();
        }, 50);
      }
    }, { allowSignalWrites: true });
  }

  ngAfterViewInit(): void {
    this.initialized = true;
    const proj = this.activeProject();
    const projId = proj ? (proj.id || proj.projectId || null) : null;
    this.currentProjectId = projId;

    if (projId) {
      this.ensureSessionExists(projId);
    }
  }

  ngOnDestroy(): void {
    this.destroyAllMountedTerminals();
    this.terminalService.closeAllSessions();
  }

  selectTab(tab: PanelTab): void {
    this.activeTab.set(tab);
    if (tab === 'terminal') {
      setTimeout(() => {
        this.fitActiveTerminal();
      }, 50);
    }
  }

  getTabLabel(tab: PanelTab): string {
    return tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ');
  }

  /**
   * Switch active terminal session tab.
   */
  selectSession(sessionId: string): void {
    this.terminalService.activeSessionId.set(sessionId);
  }

  /**
   * Add a new terminal session for the active project.
   */
  addSession(): void {
    const proj = this.activeProject();
    const projId = proj ? (proj.id || proj.projectId || null) : null;
    if (!projId) return;

    if (this.sessions().length >= 3) {
      return; // Respect user limit
    }

    const newId = this.terminalService.createSession(projId, 80, 24);
    setTimeout(() => {
      this.mountTerminal(newId);
    }, 0);
  }

  /**
   * Close a terminal session and dispose its xterm instance.
   */
  closeSession(event: MouseEvent, sessionId: string): void {
    event.stopPropagation();
    this.unmountTerminal(sessionId);
    this.terminalService.closeSession(sessionId);
  }

  /**
   * Reset the active shell session's working directory to project root.
   */
  cdToProjectRoot(): void {
    const proj = this.activeProject();
    const id = this.activeSessionId();
    if (!proj?.localPath || !id) return;
    this.terminalService.sendInput(id, `Set-Location "${proj.localPath}"\r`);
    const mounted = this.mountedTerminals.get(id);
    if (mounted) {
      mounted.term.focus();
    }
  }

  /**
   * Clear output of the active terminal session.
   */
  clearActiveTerminal(): void {
    const id = this.activeSessionId();
    if (!id) return;
    const mounted = this.mountedTerminals.get(id);
    if (mounted) {
      mounted.term.clear();
      mounted.term.focus();
    }
  }

  /**
   * Restart the active terminal session.
   */
  restartCurrentSession(): void {
    const id = this.activeSessionId();
    if (!id) return;
    const mounted = this.mountedTerminals.get(id);
    if (mounted) {
      mounted.term.reset();
      mounted.term.writeln('\x1b[90m[Restarting shell session...]\x1b[0m');
    }
    this.terminalService.restartSession(id);
  }

  private handleProjectChange(newProjectId: string | null): void {
    this.destroyAllMountedTerminals();
    this.terminalService.closeAllSessions();

    if (newProjectId) {
      this.ensureSessionExists(newProjectId);
    }
  }

  private ensureSessionExists(projectId: string): void {
    if (this.sessions().length === 0) {
      const id = this.terminalService.createSession(projectId, 80, 24);
      setTimeout(() => {
        this.mountTerminal(id);
      }, 0);
    } else {
      const active = this.activeSessionId();
      if (active && !this.mountedTerminals.has(active)) {
        this.mountTerminal(active);
      }
    }
  }

  /**
   * Mount and wire an xterm.js instance for a given session.
   */
  private mountTerminal(sessionId: string): void {
    if (this.mountedTerminals.has(sessionId)) return;
    const container = this.terminalContainerRef?.nativeElement;
    if (!container) return;

    // Create session wrapper element
    const termEl = document.createElement('div');
    termEl.className = 'devpilot-terminal-instance';
    termEl.style.width = '100%';
    termEl.style.height = '100%';
    termEl.style.display = sessionId === this.activeSessionId() ? 'block' : 'none';
    container.appendChild(termEl);

    // Initialize xterm
    const term = new Terminal({
      fontFamily: 'JetBrains Mono, Fira Code, Menlo, Monaco, "Courier New", monospace',
      fontSize: 12.5,
      lineHeight: 1.35,
      cursorBlink: true,
      cursorStyle: 'block',
      theme: DEVPILOT_TERMINAL_THEME,
      convertEol: true,
      scrollback: 5000,
      allowTransparency: false
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);
    term.open(termEl);

    // Initial fit
    try {
      fitAddon.fit();
    } catch (_) {}

    // Input -> backend
    term.onData(data => {
      this.terminalService.sendInput(sessionId, data);
    });

    // Resize -> backend
    term.onResize(size => {
      this.terminalService.sendResize(sessionId, size.cols, size.rows);
    });

    // Backend output -> terminal
    const unbindOutput = this.terminalService.onOutput(sessionId, data => {
      term.write(data);
    });

    // Backend exit -> terminal notice
    const unbindExit = this.terminalService.onExit(sessionId, (exitCode, signal) => {
      term.writeln(`\r\n\x1b[90m[Process exited with code ${exitCode ?? 0}${signal ? ` (${signal})` : ''}]\x1b[0m\r\n`);
    });

    // ResizeObserver on the container to auto-fit
    const resizeObserver = new ResizeObserver(() => {
      requestAnimationFrame(() => {
        if (termEl.style.display !== 'none') {
          try {
            fitAddon.fit();
          } catch (_) {}
        }
      });
    });
    resizeObserver.observe(container);

    const mounted: MountedTerminal = {
      sessionId,
      term,
      fitAddon,
      element: termEl,
      resizeObserver,
      unbindOutput,
      unbindExit
    };

    this.mountedTerminals.set(sessionId, mounted);

    // Trigger initial resize after render
    setTimeout(() => {
      try {
        fitAddon.fit();
        term.focus();
        if (term.cols && term.rows) {
          this.terminalService.sendResize(sessionId, term.cols, term.rows);
        }
      } catch (_) {}
    }, 100);
  }

  private updateVisibleTerminal(activeId: string): void {
    if (!this.mountedTerminals.has(activeId)) {
      this.mountTerminal(activeId);
    }

    this.mountedTerminals.forEach((mounted, id) => {
      if (id === activeId) {
        mounted.element.style.display = 'block';
        try {
          mounted.fitAddon.fit();
          mounted.term.focus();
        } catch (_) {}
      } else {
        mounted.element.style.display = 'none';
      }
    });
  }

  private fitActiveTerminal(): void {
    const id = this.activeSessionId();
    if (!id) return;
    const mounted = this.mountedTerminals.get(id);
    if (mounted) {
      try {
        mounted.fitAddon.fit();
        mounted.term.focus();
      } catch (_) {}
    }
  }

  private unmountTerminal(sessionId: string): void {
    const mounted = this.mountedTerminals.get(sessionId);
    if (!mounted) return;

    mounted.resizeObserver.disconnect();
    mounted.unbindOutput();
    mounted.unbindExit();
    try {
      mounted.term.dispose();
    } catch (_) {}
    if (mounted.element.parentNode) {
      mounted.element.parentNode.removeChild(mounted.element);
    }
    this.mountedTerminals.delete(sessionId);
  }

  private destroyAllMountedTerminals(): void {
    this.mountedTerminals.forEach((_, id) => {
      this.unmountTerminal(id);
    });
    this.mountedTerminals.clear();
  }
}
