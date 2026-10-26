import {
  Component,
  Input,
  OnInit,
  OnDestroy,
  HostListener,
  inject,
  effect
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { FormsModule } from '@angular/forms';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';
import { EditorService, EditorTab } from '../../core/services/editor.service';
import { ThemeService } from '../../core/services/theme.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { AiService } from '../../core/services/ai.service';

@Component({
  selector: 'app-editor',
  standalone: true,
  imports: [CommonModule, SharedIconsModule, FormsModule, MonacoEditorModule],
  templateUrl: './editor.component.html',
  styleUrl: './editor.component.css'
})
export class EditorComponent implements OnInit, OnDestroy {
  @Input() projectName = '';

  private editorService = inject(EditorService);
  private themeService = inject(ThemeService);
  private workspaceService = inject(WorkspaceService);
  private aiService = inject(AiService);

  readonly tabs = this.editorService.tabs;
  readonly activeTab = this.editorService.activeTab;
  readonly activeProject = this.workspaceService.activeProject;

  private monacoInstance: any = null;
  private isSwitchingModel = false;
  private currentActivePath: string | null = null;

  /** Cache of Monaco text models keyed by normalized path */
  private models = new Map<string, any>();

  /** Cache of Monaco editor view states (cursor position, scroll, folds) keyed by normalized path */
  private viewStates = new Map<string, any>();

  private unbindTabClosed?: () => void;
  private unbindTabRenamed?: () => void;
  private unbindTabExternalUpdated?: () => void;
  private unbindProjectClosed?: () => void;

  editorOptions = {
    theme: 'vs-dark',
    language: 'plaintext',
    minimap: { enabled: true },
    automaticLayout: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    scrollBeyondLastLine: false,
    smoothScrolling: true,
    renderLineHighlight: 'all',
    tabSize: 2
  };

  constructor() {
    // Synchronize Theme dynamically
    effect(() => {
      const theme = this.themeService.theme();
      const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs-light';
      this.editorOptions = { ...this.editorOptions, theme: monacoTheme };
      const monaco = (window as any).monaco;
      if (monaco?.editor) {
        monaco.editor.setTheme(monacoTheme);
      }
    });

    // Synchronize active open file with AI Context automatically
    effect(() => {
      const tab = this.activeTab();
      if (tab) {
        this.aiService.updateContext({ currentFile: tab.path });
      } else {
        this.aiService.updateContext({ currentFile: '', selectedCode: '' });
      }
    }, { allowSignalWrites: true });

    // Switch Monaco model whenever activeTab changes
    effect(() => {
      const tab = this.activeTab();
      if (this.monacoInstance) {
        if (tab) {
          this.switchActiveModel(tab);
        } else {
          this.currentActivePath = null;
        }
      }
    });
  }

  ngOnInit(): void {
    // Listen for tab closures to cleanly dispose Monaco models
    this.unbindTabClosed = this.editorService.onTabClosed((path) => {
      this.disposeModelForPath(path);
    });

    // Listen for tab renames to update model keys and Monaco model identity
    this.unbindTabRenamed = this.editorService.onTabRenamed((oldPath, newPath) => {
      const monaco = (window as any).monaco;
      const proj = this.workspaceService.activeProject();
      const projId = proj ? (proj.id || proj.projectId || 'devpilot') : 'devpilot';

      if (this.models.has(oldPath)) {
        const oldModel = this.models.get(oldPath);
        this.models.delete(oldPath);

        if (monaco?.editor) {
          const content = oldModel ? oldModel.getValue() : '';
          const newExt = newPath.includes('.') ? newPath.split('.').pop() || '' : '';
          const lang = this.resolveLanguage(newExt);
          const newUri = monaco.Uri.parse(`devpilot://${projId}/${newPath}`);

          const existingNewModel = monaco.editor.getModel(newUri);
          if (existingNewModel) {
            try { existingNewModel.dispose(); } catch (_) {}
          }

          const newModel = monaco.editor.createModel(content, lang, newUri);
          newModel.onDidChangeContent(() => {
            if (this.isSwitchingModel) return;
            this.editorService.updateContent(newPath, newModel.getValue());
          });

          this.models.set(newPath, newModel);

          if (this.monacoInstance && this.currentActivePath === oldPath) {
            this.monacoInstance.setModel(newModel);
          }

          if (oldModel) {
            try { oldModel.dispose(); } catch (_) {}
          }
        }
      }

      if (this.viewStates.has(oldPath)) {
        const vs = this.viewStates.get(oldPath);
        this.viewStates.delete(oldPath);
        this.viewStates.set(newPath, vs);
      }
      if (this.currentActivePath === oldPath) {
        this.currentActivePath = newPath;
      }
    });

    // Listen for external file updates (e.g. from terminal commands) to update Monaco model
    this.unbindTabExternalUpdated = this.editorService.onTabExternalUpdated((path, freshContent) => {
      const tab = this.tabs().find(t => t.path === path);
      if (tab?.dirty) return; // Prevent overwriting unsaved changes

      const model = this.models.get(path);
      if (model && model.getValue() !== freshContent) {
        this.isSwitchingModel = true;
        try {
          model.setValue(freshContent);
        } finally {
          this.isSwitchingModel = false;
        }
      }
    });

    // Listen for project closure to cleanly dispose all models
    this.unbindProjectClosed = this.workspaceService.onProjectClosed(() => {
      for (const model of this.models.values()) {
        try { model.dispose(); } catch (_) {}
      }
      this.models.clear();
      this.viewStates.clear();
      this.currentActivePath = null;
    });
  }

  ngOnDestroy(): void {
    this.unbindTabClosed?.();
    this.unbindTabRenamed?.();
    this.unbindTabExternalUpdated?.();
    this.unbindProjectClosed?.();

    // Dispose all created Monaco models safely
    for (const model of this.models.values()) {
      try {
        model.dispose();
      } catch (_) {}
    }
    this.models.clear();
    this.viewStates.clear();

    if (this.monacoInstance) {
      try {
        this.monacoInstance.dispose();
      } catch (_) {}
      this.monacoInstance = null;
    }
  }

  onEditorInit(editor: any): void {
    this.monacoInstance = editor;
    const monaco = (window as any).monaco;

    // Apply active theme
    const theme = this.themeService.theme();
    const monacoTheme = theme === 'dark' ? 'vs-dark' : 'vs-light';
    if (monaco?.editor) {
      monaco.editor.setTheme(monacoTheme);
    }

    // Register Ctrl+S keyboard shortcut inside Monaco
    if (monaco?.KeyMod && monaco?.KeyCode) {
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        this.editorService.saveActiveTab();
      });
    }

    // Listen to selection changes in Monaco and update AI Context in real time
    editor.onDidChangeCursorSelection(() => {
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) {
        this.aiService.updateContext({ selectedCode: '' });
      } else {
        const model = editor.getModel();
        const selectedText = model ? model.getValueInRange(selection) : '';
        this.aiService.updateContext({ selectedCode: selectedText });
      }
    });

    // Mount current active tab model if available
    const active = this.activeTab();
    if (active) {
      this.switchActiveModel(active);
    }
  }

  selectTab(tab: EditorTab): void {
    this.editorService.setActiveTab(tab.path);
    this.aiService.updateContext({ currentFile: tab.path, selectedCode: '' });
  }

  closeTab(tab: EditorTab, e: MouseEvent): void {
    e.stopPropagation();
    this.editorService.closeTab(tab.path);
    const active = this.activeTab();
    this.aiService.updateContext({ currentFile: active?.path || '', selectedCode: '' });
  }

  getFileIcon(ext: string): string {
    const icons: Record<string, string> = {
      ts: 'code-2',
      js: 'file-code-2',
      json: 'file-json',
      md: 'file-text',
      css: 'palette',
      html: 'globe',
      py: 'code-2',
      java: 'code-2',
      c: 'code-2',
      cpp: 'code-2',
      sql: 'server',
      sh: 'terminal',
      bat: 'terminal',
      ps1: 'terminal'
    };
    return icons[ext] || 'file';
  }

  getBreadcrumbs(path: string): string[] {
    if (!path) return [];
    return path.replace(/\\/g, '/').split('/').filter(s => s.trim().length > 0);
  }

  resolveLanguage(ext: string): string {
    const cleanExt = (ext || '').toLowerCase().replace(/^\./, '');
    const langMap: Record<string, string> = {
      ts: 'typescript',
      js: 'javascript',
      mjs: 'javascript',
      cjs: 'javascript',
      jsx: 'javascript',
      tsx: 'typescript',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'scss',
      less: 'less',
      json: 'json',
      jsonc: 'json',
      md: 'markdown',
      markdown: 'markdown',
      xml: 'xml',
      svg: 'xml',
      yaml: 'yaml',
      yml: 'yaml',
      py: 'python',
      java: 'java',
      c: 'c',
      h: 'c',
      cpp: 'cpp',
      hpp: 'cpp',
      cc: 'cpp',
      cs: 'csharp',
      go: 'go',
      rs: 'rust',
      php: 'php',
      sql: 'sql',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      bat: 'bat',
      cmd: 'bat',
      ps1: 'powershell',
      dockerfile: 'dockerfile'
    };
    return langMap[cleanExt] || 'plaintext';
  }

  /**
   * Retrieves or creates an isolated Monaco ITextModel with stable URI.
   */
  private getOrCreateModel(tab: EditorTab): any {
    const monaco = (window as any).monaco;
    if (!monaco?.editor) return null;

    const normalized = tab.path.replace(/\\/g, '/').replace(/^\/+/, '');
    const proj = this.workspaceService.activeProject();
    const projId = proj ? (proj.id || proj.projectId || 'devpilot') : 'devpilot';
    const uri = monaco.Uri.parse(`devpilot://${projId}/${normalized}`);

    let model = monaco.editor.getModel(uri);
    const lang = this.resolveLanguage(tab.extension);

    if (!model) {
      model = monaco.editor.createModel(tab.content, lang, uri);

      // Track live content changes in the model
      model.onDidChangeContent(() => {
        if (this.isSwitchingModel) return;
        const val = model.getValue();
        this.editorService.updateContent(tab.path, val);
      });
    } else {
      monaco.editor.setModelLanguage(model, lang);
    }

    this.models.set(tab.path, model);
    return model;
  }

  /**
   * Switches the active Monaco model cleanly, saving and restoring viewState.
   */
  private switchActiveModel(tab: EditorTab): void {
    if (!this.monacoInstance) return;
    const monaco = (window as any).monaco;
    if (!monaco?.editor) return;

    // 1. Save previous tab viewState (cursor, scroll, selection)
    if (this.currentActivePath && this.currentActivePath !== tab.path) {
      const prevViewState = this.monacoInstance.saveViewState();
      if (prevViewState) {
        this.viewStates.set(this.currentActivePath, prevViewState);
      }
    }

    this.currentActivePath = tab.path;
    this.isSwitchingModel = true;

    try {
      const model = this.getOrCreateModel(tab);
      if (model) {
        this.monacoInstance.setModel(model);

        // Restore viewState if available
        const savedViewState = this.viewStates.get(tab.path);
        if (savedViewState) {
          this.monacoInstance.restoreViewState(savedViewState);
        }
        this.monacoInstance.focus();
      }
    } finally {
      this.isSwitchingModel = false;
    }
  }

  private disposeModelForPath(path: string): void {
    const model = this.models.get(path);
    if (model) {
      try {
        model.dispose();
      } catch (_) {}
      this.models.delete(path);
    }
    this.viewStates.delete(path);
    if (this.currentActivePath === path) {
      this.currentActivePath = null;
    }
  }

  @HostListener('window:keydown', ['$event'])
  async onKeyDown(event: KeyboardEvent): Promise<void> {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      await this.editorService.saveActiveTab();
    }
  }
}
