import { Component, Input, signal, OnInit, OnDestroy, HostListener, inject, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { FormsModule } from '@angular/forms';
import { MonacoEditorModule } from 'ngx-monaco-editor-v2';
import { EditorService, EditorTab } from '../../core/services/editor.service';
import { ThemeService } from '../../core/services/theme.service';

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

  readonly tabs = this.editorService.tabs;
  readonly activeTab = this.editorService.activeTab;

  editorOptions = {
    theme: 'vs-dark',
    language: 'typescript',
    minimap: { enabled: true },
    automaticLayout: true,
    fontSize: 13,
    fontFamily: "'JetBrains Mono', monospace"
  };

  constructor() {
    effect(() => {
      const theme = this.themeService.theme();
      this.editorOptions = { ...this.editorOptions, theme: theme === 'dark' ? 'vs-dark' : 'vs-light' };
    });
  }

  ngOnInit() { }

  ngOnDestroy() { }

  selectTab(tab: EditorTab): void {
    this.editorService.setActiveTab(tab.path);
    this.updateLanguage(tab.extension);
  }

  closeTab(tab: EditorTab, e: MouseEvent): void {
    e.stopPropagation();
    this.editorService.closeTab(tab.path);
  }

  getFileIcon(ext: string): string {
    const icons: Record<string, string> = {
      ts: 'code-2', js: 'file-code-2', json: 'file-json', md: 'file-text', css: 'palette', html: 'globe'
    };
    return icons[ext] || 'file';
  }

  updateLanguage(ext: string) {
    const langMap: Record<string, string> = {
      'ts': 'typescript',
      'js': 'javascript',
      'html': 'html',
      'css': 'css',
      'json': 'json',
      'md': 'markdown',
      'yaml': 'yaml',
      'yml': 'yaml',
      'java': 'java',
      'py': 'python',
      'cpp': 'cpp',
      'c': 'c',
      'sql': 'sql',
      'xml': 'xml',
      'sh': 'shell'
    };
    this.editorOptions = { ...this.editorOptions, language: langMap[ext] || 'plaintext' };
  }

  onContentChange(content: string) {
    const active = this.activeTab();
    if (active) {
      this.editorService.updateContent(active.path, content);
    }
  }

  @HostListener('window:keydown', ['$event'])
  async onKeyDown(event: KeyboardEvent) {
    if ((event.ctrlKey || event.metaKey) && event.key === 's') {
      event.preventDefault();
      await this.editorService.saveActiveTab();
    }
  }
}
