import { Component, inject, signal, computed, OnInit, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormsModule, FormControl, Validators } from '@angular/forms';
import { DomSanitizer, SafeHtml } from '@angular/platform-browser';
import { AiService } from '../../core/services/ai.service';
import { ProjectService } from '../../core/services/project.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import {
  DocumentationType,
  DocTypeOption,
  GeneratedDocument,
  DocAudience,
  DocTone,
  DocLength
} from '../../shared/models/ai.model';
import { Project } from '../../shared/models/project.model';
import { Subscription } from 'rxjs';

export type DocView = 'grid' | 'generator' | 'viewer';
export type ViewerMode = 'preview' | 'edit' | 'split';

interface QuickDocCard {
  title: string;
  description: string;
  icon: string;
  type: DocumentationType;
  badge?: string;
}

const QUICK_CARDS: QuickDocCard[] = [
  { title: 'Project README', description: 'Comprehensive overview, setup guide, and usage instructions', icon: 'file-text', type: 'readme', badge: 'Popular' },
  { title: 'API Reference', description: 'REST API endpoints, schemas, authentication, and examples', icon: 'zap', type: 'api', badge: 'Technical' },
  { title: 'Architecture Guide', description: 'System overview, data flow, component boundaries, and security', icon: 'layers', type: 'architecture' },
  { title: 'Code Documentation', description: 'Component, module, and class walkthroughs and logic flows', icon: 'code-2', type: 'code' },
  { title: 'Deployment Guide', description: 'Production prerequisites, build pipelines, env vars, and Docker', icon: 'rocket', type: 'deployment' },
  { title: 'Project Proposal', description: 'Problem statement, proposed architecture, timeline, and deliverables', icon: 'sparkles', type: 'proposal' },
  { title: 'Project Report', description: 'Executive summary, findings, performance analysis, and next steps', icon: 'file-code-2', type: 'report' },
  { title: 'Meeting Notes', description: 'Objectives, key technical discussions, decisions, and action items', icon: 'clock', type: 'meeting_notes' }
];

@Component({
  selector: 'app-documentation',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, FormsModule, SharedIconsModule],
  templateUrl: './documentation.component.html',
  styleUrl: './documentation.component.css'
})
export class DocumentationComponent implements OnInit, OnDestroy {
  private aiService = inject(AiService);
  private projectService = inject(ProjectService);
  private workspaceService = inject(WorkspaceService);
  private notifService = inject(NotificationService);
  private sanitizer = inject(DomSanitizer);

  // Navigation and Layout state
  readonly view = signal<DocView>('grid');
  readonly viewerMode = signal<ViewerMode>('split');
  readonly quickCards = QUICK_CARDS;

  // Project state
  readonly projects = signal<Project[]>([]);
  readonly selectedProject = signal<Project | null>(null);
  readonly isLoadingProjects = signal(false);

  // Document history state
  readonly projectDocuments = signal<GeneratedDocument[]>([]);
  readonly isLoadingHistory = signal(false);
  readonly currentDocument = signal<GeneratedDocument | null>(null);

  // Generator form controls
  readonly selectedType = new FormControl<DocumentationType>('readme', { nonNullable: true, validators: [Validators.required] });
  readonly titleControl = new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(120)] });
  readonly instructionsControl = new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(4000)] });
  readonly sourceContentControl = new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(32000)] });
  readonly audienceControl = new FormControl<DocAudience>('developers', { nonNullable: true });
  readonly toneControl = new FormControl<DocTone>('technical', { nonNullable: true });
  readonly lengthControl = new FormControl<DocLength>('medium', { nonNullable: true });
  readonly includeContextControl = new FormControl<boolean>(true, { nonNullable: true });
  readonly showAdvancedOptions = signal(false);

  // Viewer / Editor controls
  readonly editableContent = new FormControl<string>('', { nonNullable: true });
  readonly editableTitle = new FormControl<string>('', { nonNullable: true });
  readonly revisionControl = new FormControl<string>('', { nonNullable: true, validators: [Validators.maxLength(2000)] });
  readonly showRevisionBar = signal(false);
  readonly isSaving = signal(false);
  readonly isSavingToWorkspace = signal(false);
  readonly isRevising = signal(false);

  // Generation status and progress
  readonly isGenerating = signal(false);
  readonly generationError = signal<string | null>(null);
  readonly generationStep = signal('Initializing generation request...');
  readonly currentStep = signal(1);
  readonly generationSteps = [
    'Initializing request and validating inputs...',
    'Analyzing project structure & configuration...',
    'Synthesizing documentation with local Ollama model...',
    'Normalizing markdown formatting & extracting sections...'
  ];

  // Options loaded from backend
  readonly backendDocTypes = signal<DocTypeOption[]>([]);
  readonly defaultDocTypes: DocTypeOption[] = [
    { id: 'readme', name: 'Project README', description: 'Overview, setup guide, and usage instructions', defaultTitle: 'README.md' },
    { id: 'api', name: 'API Reference', description: 'REST endpoints, request/response schemas, and examples', defaultTitle: 'API.md' },
    { id: 'architecture', name: 'Architecture Guide', description: 'System design, diagrams, and components', defaultTitle: 'ARCHITECTURE.md' },
    { id: 'code', name: 'Code Documentation', description: 'Walkthroughs of core modules, functions, and classes', defaultTitle: 'CODE_DOCS.md' },
    { id: 'deployment', name: 'Deployment Guide', description: 'Environment config, build pipelines, and production setup', defaultTitle: 'DEPLOYMENT.md' },
    { id: 'proposal', name: 'Project Proposal', description: 'Problem statement, proposed architecture, and milestones', defaultTitle: 'PROPOSAL.md' },
    { id: 'report', name: 'Project Report', description: 'Executive summary, findings, and technical analysis', defaultTitle: 'REPORT.md' },
    { id: 'meeting_notes', name: 'Meeting Notes', description: 'Decisions, discussions, attendees, and action items', defaultTitle: 'MEETING_NOTES.md' },
    { id: 'study_notes', name: 'Study Notes', description: 'Structured learning notes and conceptual explanations', defaultTitle: 'STUDY_NOTES.md' },
    { id: 'business', name: 'Business Doc', description: 'Business requirements, ROI, and delivery overview', defaultTitle: 'BUSINESS_PLAN.md' },
    { id: 'custom', name: 'Custom Document', description: 'Tailored markdown document using custom instructions', defaultTitle: 'DOCUMENT.md' }
  ];

  readonly availableDocTypes = computed<DocTypeOption[]>(() => {
    const backend = this.backendDocTypes();
    return backend.length > 0 ? backend : this.defaultDocTypes;
  });

  toggleAdvancedOptions(): void {
    this.showAdvancedOptions.update(v => !v);
  }

  readonly sanitizedPreviewHtml = computed<SafeHtml>(() => {
    const raw = this.editableContent.value || '';
    return this.sanitizer.bypassSecurityTrustHtml(this.renderMarkdownSafely(raw));
  });

  private stepInterval: any = null;
  private subs = new Subscription();

  ngOnInit(): void {
    this.loadInitialProjects();
    this.loadDocTypes();
  }

  ngOnDestroy(): void {
    this.subs.unsubscribe();
    this.clearIntervalTimer();
  }

  /**
   * Load user's projects and activate current selection
   */
  loadInitialProjects(): void {
    this.isLoadingProjects.set(true);
    this.projectService.getProjects().subscribe({
      next: (projs) => {
        this.isLoadingProjects.set(false);
        this.projects.set(projs || []);
        
        // Priority: currently active project in ProjectService > first available project
        const active = this.projectService.activeProject();
        if (active) {
          const match = projs.find(p => p.id === active.id) || active;
          this.selectedProject.set(match);
        } else if (projs.length > 0) {
          this.selectedProject.set(projs[0]);
        }

        if (this.selectedProject()?.id) {
          this.loadProjectHistory();
        }
      },
      error: () => {
        this.isLoadingProjects.set(false);
        // Fallback to active project if already in memory
        const active = this.projectService.activeProject();
        if (active) {
          this.selectedProject.set(active);
          this.loadProjectHistory();
        }
      }
    });
  }

  /**
   * Fetch backend document types
   */
  loadDocTypes(): void {
    this.aiService.getDocumentTypes().subscribe({
      next: (types) => {
        if (types && types.length > 0) {
          this.backendDocTypes.set(types);
        }
      },
      error: () => {
        // Keeps fallback types
      }
    });
  }

  /**
   * Switch active project and reload history
   */
  onProjectChange(projectId: string): void {
    const found = this.projects().find(p => p.id === projectId) || null;
    this.selectedProject.set(found);
    if (found?.id) {
      this.loadProjectHistory();
    } else {
      this.projectDocuments.set([]);
    }
  }

  /**
   * Load document history for currently selected project
   */
  loadProjectHistory(): void {
    const projId = this.selectedProject()?.id;
    if (!projId) return;

    this.isLoadingHistory.set(true);
    this.aiService.getProjectDocuments(projId).subscribe({
      next: (docs) => {
        this.isLoadingHistory.set(false);
        this.projectDocuments.set(docs || []);
      },
      error: () => {
        this.isLoadingHistory.set(false);
      }
    });
  }

  /**
   * Open the Generator form with an optional preselected type
   */
  openGenerator(type?: DocumentationType): void {
    if (type) {
      this.selectedType.setValue(type);
    }
    const currentProjName = this.selectedProject()?.displayName || this.selectedProject()?.name || 'Project';
    if (!this.titleControl.value) {
      const typeLabel = this.getTypeLabel(this.selectedType.value);
      this.titleControl.setValue(`${typeLabel} — ${currentProjName}`);
    }
    this.generationError.set(null);
    this.view.set('generator');
  }

  /**
   * Change doc type in generator and update default title if unset
   */
  selectDocType(type: string | DocumentationType): void {
    const docType = type as DocumentationType;
    this.selectedType.setValue(docType);
    const projName = this.selectedProject()?.displayName || this.selectedProject()?.name || 'Project';
    const typeLabel = this.getTypeLabel(docType);
    this.titleControl.setValue(`${typeLabel} — ${projName}`);
  }

  /**
   * Submit document generation request to local Ollama pipeline
   */
  generate(): void {
    const proj = this.selectedProject();
    if (!proj?.id) {
      this.notifService.show('Please select a project before generating documentation.', 'error');
      return;
    }

    if (this.isGenerating()) return;

    this.isGenerating.set(true);
    this.generationError.set(null);
    this.currentStep.set(1);
    this.generationStep.set(this.generationSteps[0]);

    this.startStepProgression();

    const payload = {
      projectId: proj.id,
      docType: this.selectedType.value,
      title: this.titleControl.value.trim() || undefined,
      instructions: this.instructionsControl.value.trim() || undefined,
      sourceContent: this.sourceContentControl.value.trim() || undefined,
      audience: this.audienceControl.value,
      tone: this.toneControl.value,
      length: this.lengthControl.value,
      includeProjectContext: this.includeContextControl.value
    };

    this.aiService.generateDoc(payload).subscribe({
      next: (doc: GeneratedDocument) => {
        this.clearIntervalTimer();
        this.isGenerating.set(false);
        this.currentDocument.set(doc);
        this.editableContent.setValue(doc.content || '');
        this.editableTitle.setValue(doc.title || 'Generated Document');
        this.view.set('viewer');
        this.notifService.show(`Documentation "${doc.title}" generated successfully!`, 'success');
        this.loadProjectHistory();
      },
      error: (err) => {
        this.clearIntervalTimer();
        this.isGenerating.set(false);
        const errorMsg = err.message || 'Documentation generation failed. Please check Ollama status.';
        this.generationError.set(errorMsg);
        this.notifService.show(errorMsg, 'error');
      }
    });
  }

  /**
   * Open an existing document from history in Viewer / Editor
   */
  openDocument(doc: GeneratedDocument): void {
    this.currentDocument.set(doc);
    this.editableContent.setValue(doc.content || '');
    this.editableTitle.setValue(doc.title || 'Untitled Document');
    this.showRevisionBar.set(false);
    this.view.set('viewer');
  }

  /**
   * Save manual edits to the current document in MongoDB
   */
  saveDocumentChanges(): void {
    const doc = this.currentDocument();
    if (!doc?._id) return;

    const newTitle = this.editableTitle.value.trim() || doc.title;
    const newContent = this.editableContent.value;

    this.isSaving.set(true);
    this.aiService.updateDocument(doc._id, { title: newTitle, content: newContent }).subscribe({
      next: (updatedDoc) => {
        this.isSaving.set(false);
        this.currentDocument.set(updatedDoc);
        this.notifService.show(`Document saved (Version ${updatedDoc.version}).`, 'success');
        this.loadProjectHistory();
      },
      error: (err) => {
        this.isSaving.set(false);
        this.notifService.show(err.message || 'Failed to save changes.', 'error');
      }
    });
  }

  /**
   * Save generated document directly to the project workspace on disk
   */
  saveToWorkspace(): void {
    const doc = this.currentDocument();
    const proj = this.selectedProject();
    if (!doc || !proj?.id) {
      this.notifService.show('Please select an active project workspace.', 'error');
      return;
    }

    const defaultPath = doc.docType === 'readme' ? 'README.md' : `docs/${doc.docType}.md`;
    const targetPath = prompt('Enter the destination path in project workspace:', defaultPath);
    if (!targetPath || !targetPath.trim()) return;

    this.isSavingToWorkspace.set(true);
    this.aiService.saveDocToProject({
      documentId: doc._id,
      projectId: proj.id,
      targetPath: targetPath.trim(),
      content: this.editableContent.value,
      saveToProject: true
    }).subscribe({
      next: (res) => {
        this.isSavingToWorkspace.set(false);
        this.notifService.show(res.message || `File saved to ${res.filePath || targetPath}`, 'success');

        // Refresh Explorer if active project
        if (this.projectService.activeProject()?.id === proj.id) {
          this.projectService.getProjectFiles(proj.id).subscribe({
            next: (tree) => this.workspaceService.fileTree.set(tree)
          });
        }
      },
      error: (err) => {
        this.isSavingToWorkspace.set(false);
        this.notifService.show(err.message || 'Failed to write document to filesystem.', 'error');
      }
    });
  }

  /**
   * Toggle AI revision bar
   */
  toggleRevisionBar(): void {
    this.showRevisionBar.update(v => !v);
  }

  /**
   * Apply AI revision to the current document
   */
  applyRevision(): void {
    const instruction = this.revisionControl.value.trim();
    if (!instruction) {
      this.notifService.show('Please enter revision instructions.', 'error');
      return;
    }

    const doc = this.currentDocument();
    const currentContent = this.editableContent.value;

    this.isRevising.set(true);
    this.aiService.reviseDoc({
      documentId: doc?._id,
      currentContent,
      revisionInstruction: instruction,
      docType: doc?.docType || this.selectedType.value,
      title: this.editableTitle.value.trim() || doc?.title
    }).subscribe({
      next: (revisedDoc) => {
        this.isRevising.set(false);
        this.revisionControl.reset();
        this.showRevisionBar.set(false);
        this.editableContent.setValue(revisedDoc.content);
        if (revisedDoc._id) {
          this.currentDocument.set(revisedDoc);
        }
        this.notifService.show('AI revision applied successfully!', 'success');
        this.loadProjectHistory();
      },
      error: (err) => {
        this.isRevising.set(false);
        this.notifService.show(err.message || 'Failed to revise document with AI.', 'error');
      }
    });
  }

  /**
   * Delete a document from MongoDB history
   */
  deleteDocument(docId: string, event?: Event): void {
    if (event) event.stopPropagation();
    if (!confirm('Are you sure you want to delete this document from history?')) return;

    this.aiService.deleteDocument(docId).subscribe({
      next: () => {
        this.notifService.show('Document deleted.', 'info');
        if (this.currentDocument()?._id === docId) {
          this.backToGrid();
        }
        this.loadProjectHistory();
      },
      error: (err) => {
        this.notifService.show(err.message || 'Failed to delete document.', 'error');
      }
    });
  }

  /**
   * Export document as Markdown or HTML
   */
  exportDocument(format: 'markdown' | 'html'): void {
    const doc = this.currentDocument();
    const title = this.editableTitle.value.trim() || doc?.title || 'document';
    const ext = format === 'markdown' ? 'md' : 'html';
    const filename = `${this.slugify(title)}.${ext}`;
    const content = this.editableContent.value;

    if (format === 'markdown') {
      this.triggerDownload(content, filename, 'text/markdown;charset=utf-8');
      this.notifService.show(`Exported ${filename}`, 'success');
    } else {
      // Export as formatted HTML
      const htmlBody = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${this.escapeHtml(title)}</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; line-height: 1.6; max-width: 860px; margin: 40px auto; padding: 0 20px; color: #1e293b; }
    h1, h2, h3, h4 { color: #0f172a; margin-top: 1.5em; }
    code { background: #f1f5f9; padding: 2px 6px; border-radius: 4px; font-family: monospace; font-size: 0.9em; }
    pre { background: #0f172a; color: #f8fafc; padding: 16px; border-radius: 8px; overflow-x: auto; font-family: monospace; }
    pre code { background: transparent; padding: 0; color: inherit; }
    blockquote { border-left: 4px solid #6366f1; padding-left: 16px; margin-left: 0; color: #64748b; }
    table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    th, td { border: 1px solid #cbd5e1; padding: 10px 12px; text-align: left; }
    th { background: #f8fafc; font-weight: 600; }
  </style>
</head>
<body>
  <h1>${this.escapeHtml(title)}</h1>
  ${this.renderMarkdownSafely(content)}
</body>
</html>`;
      this.triggerDownload(htmlBody, filename, 'text/html;charset=utf-8');
      this.notifService.show(`Exported ${filename}`, 'success');
    }
  }

  /**
   * Copy markdown content to clipboard
   */
  copyToClipboard(): void {
    const text = this.editableContent.value;
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      this.notifService.show('Markdown copied to clipboard!', 'info');
    }).catch(() => {
      this.notifService.show('Failed to copy to clipboard.', 'error');
    });
  }

  setViewerMode(mode: ViewerMode): void {
    this.viewerMode.set(mode);
  }

  backToGrid(): void {
    this.view.set('grid');
    this.currentDocument.set(null);
  }

  getTypeLabel(type: string | DocumentationType): string {
    const map: Record<string, string> = {
      readme: 'README',
      api: 'API Reference',
      code: 'Code Documentation',
      architecture: 'Architecture Guide',
      deployment: 'Deployment Guide',
      proposal: 'Project Proposal',
      report: 'Project Report',
      meeting_notes: 'Meeting Notes',
      study_notes: 'Study Notes',
      business: 'Business Document',
      custom: 'Custom Documentation'
    };
    return map[type] || 'Documentation';
  }

  getTypeIcon(type: string | DocumentationType): string {
    const map: Record<string, string> = {
      readme: 'file-text',
      api: 'zap',
      code: 'code-2',
      architecture: 'layers',
      deployment: 'rocket',
      proposal: 'sparkles',
      report: 'file-code-2',
      meeting_notes: 'clock',
      study_notes: 'lightbulb',
      business: 'file',
      custom: 'file-text'
    };
    return map[type] || 'file-text';
  }

  getWordCount(text: string | null | undefined): number {
    if (!text) return 0;
    return text.trim().split(/\s+/).filter(Boolean).length;
  }

  private startStepProgression(): void {
    this.clearIntervalTimer();
    let idx = 0;
    this.stepInterval = setInterval(() => {
      idx++;
      if (idx < this.generationSteps.length) {
        this.currentStep.set(idx + 1);
        this.generationStep.set(this.generationSteps[idx]);
      }
    }, 4500);
  }

  private clearIntervalTimer(): void {
    if (this.stepInterval) {
      clearInterval(this.stepInterval);
      this.stepInterval = null;
    }
  }

  private triggerDownload(content: string, filename: string, mimeType: string): void {
    const blob = new Blob([content], { type: mimeType });
    const url = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(url);
  }

  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/[\s_-]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'document';
  }

  private escapeHtml(str: string): string {
    return (str || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * Safe, robust Markdown parser that prevents executable HTML injection
   */
  private renderMarkdownSafely(markdown: string): string {
    if (!markdown) return '<p class="devpilot-docs-empty-preview">No document content to preview.</p>';

    // 1. Strict HTML entity escaping
    let html = this.escapeHtml(markdown);

    // 2. Fenced code blocks
    html = html.replace(/```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
      const language = lang ? lang.trim() : 'text';
      return `<div class="devpilot-docs-code-block"><div class="devpilot-docs-code-header"><span>${language}</span></div><pre><code>${code.trim()}</code></pre></div>`;
    });

    // 3. Inline code
    html = html.replace(/`([^`\n]+)`/g, '<code class="devpilot-docs-inline-code">$1</code>');

    // 4. Headings
    html = html.replace(/^#### (.*?)$/gm, '<h4 class="devpilot-docs-h4">$1</h4>');
    html = html.replace(/^### (.*?)$/gm, '<h3 class="devpilot-docs-h3">$1</h3>');
    html = html.replace(/^## (.*?)$/gm, '<h2 class="devpilot-docs-h2">$1</h2>');
    html = html.replace(/^# (.*?)$/gm, '<h1 class="devpilot-docs-h1">$1</h1>');

    // 5. Blockquotes
    html = html.replace(/^> (.*?)$/gm, '<blockquote class="devpilot-docs-blockquote">$1</blockquote>');

    // 6. Horizontal rule
    html = html.replace(/^---$/gm, '<hr class="devpilot-docs-hr" />');

    // 7. Bold & Italic
    html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/\*(.*?)\*/g, '<em>$1</em>');

    // 8. Lists (unordered)
    html = html.replace(/^[-*] (.*?)$/gm, '<li class="devpilot-docs-li">$1</li>');
    html = html.replace(/((?:<li class="devpilot-docs-li">.*?<\/li>\s*)+)/gs, '<ul class="devpilot-docs-ul">$1</ul>');

    // 9. Tables
    html = html.replace(/((?:\|[^\n]+\|\n)+)/g, (tableText) => {
      const lines = tableText.trim().split('\n');
      if (lines.length < 2) return tableText;
      const isHeaderSep = (line: string) => /^\|(?:\s*:?-+:?\s*\|)+$/.test(line.trim());
      let tableHtml = '<div class="devpilot-docs-table-wrapper"><table class="devpilot-docs-table">';
      lines.forEach((line, index) => {
        if (isHeaderSep(line)) return;
        const cells = line.split('|').slice(1, -1);
        const isHeader = index === 0;
        const tag = isHeader ? 'th' : 'td';
        tableHtml += '<tr>';
        cells.forEach(cell => {
          tableHtml += `<${tag}>${cell.trim()}</${tag}>`;
        });
        tableHtml += '</tr>';
      });
      tableHtml += '</table></div>';
      return tableHtml;
    });

    // 10. Paragraphs & Line breaks
    const blocks = html.split(/\n{2,}/);
    html = blocks
      .map(b => {
        const trimmed = b.trim();
        if (!trimmed) return '';
        if (
          trimmed.startsWith('<h1') ||
          trimmed.startsWith('<h2') ||
          trimmed.startsWith('<h3') ||
          trimmed.startsWith('<h4') ||
          trimmed.startsWith('<div class="devpilot-docs-code-block"') ||
          trimmed.startsWith('<ul') ||
          trimmed.startsWith('<ol') ||
          trimmed.startsWith('<blockquote') ||
          trimmed.startsWith('<hr') ||
          trimmed.startsWith('<div class="devpilot-docs-table-wrapper"')
        ) {
          return trimmed;
        }
        return `<p class="devpilot-docs-p">${trimmed.replace(/\n/g, '<br/>')}</p>`;
      })
      .join('\n');

    return html;
  }
}
