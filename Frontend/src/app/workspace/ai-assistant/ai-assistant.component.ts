import { Component, Input, Output, EventEmitter, inject, signal, ViewChild, ElementRef, AfterViewChecked, effect } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { AiService } from '../../core/services/ai.service';
import { AIMessage, AIProposedChange } from '../../shared/models/ai.model';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { EditorService } from '../../core/services/editor.service';
import { WorkspaceService } from '../../core/services/workspace.service';
import { ProjectService } from '../../core/services/project.service';

export interface DiffLine {
  type: 'added' | 'removed' | 'unchanged';
  text: string;
  oldNum?: number;
  newNum?: number;
}

@Component({
  selector: 'app-ai-assistant',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedIconsModule],
  templateUrl: './ai-assistant.component.html',
  styleUrl: './ai-assistant.component.css'
})
export class AiAssistantComponent implements AfterViewChecked {
  @Input() projectName = '';
  @Output() closePanel = new EventEmitter<void>();
  @ViewChild('messagesEnd') messagesEnd!: ElementRef;

  private aiService = inject(AiService);
  private notifService = inject(NotificationService);
  private editorService = inject(EditorService);
  private workspaceService = inject(WorkspaceService);
  private projectService = inject(ProjectService);

  readonly messages = signal<AIMessage[]>([
    {
      id: '0',
      role: 'assistant',
      content: `Hello! I'm DevPilot AI. I can help you:\n\n- **Explain** your code\n- **Fix** bugs and errors\n- **Generate** tests, docs, and boilerplate\n- **Refactor** for best practices\n\nSelect code in the editor or just ask me anything!`,
      timestamp: new Date()
    }
  ]);

  readonly inputControl = new FormControl('');
  readonly isThinking = this.aiService.isThinking;
  readonly context = this.aiService.context;
  readonly isApplyingChange = signal(false);

  // Tracks which change diffs are currently expanded (key: `${messageId}-${fileIndex}`)
  readonly expandedDiffs = signal<Record<string, boolean>>({});

  readonly quickActions = [
    { label: 'Explain Code', icon: 'lightbulb', prompt: 'Explain this code' },
    { label: 'Fix Error', icon: 'wrench', prompt: 'Fix the error in this code' },
    { label: 'Generate Code', icon: 'zap', prompt: 'Generate code for this feature' },
    { label: 'Refactor', icon: 'refresh-cw', prompt: 'Refactor this code to be cleaner' },
    { label: 'Write Tests', icon: 'flask-conical', prompt: 'Write unit tests for this function' },
    { label: 'Generate Docs', icon: 'file-text', prompt: 'Generate documentation for this code' }
  ];

  readonly quickActionsExpanded = signal(true);

  constructor() {
    effect(() => {
      // Whenever project changes, reset conversation messages to prevent cross-project context leaks
      const projId = this.context().projectId;
      this.messages.set([
        {
          id: '0',
          role: 'assistant',
          content: `Hello! I'm DevPilot AI. I can help you with ${this.context().projectName || 'your project'}:\n\n- **Explain** your code\n- **Fix** bugs and errors\n- **Generate** tests, docs, and boilerplate\n- **Refactor** for best practices\n\nSelect code in the editor or just ask me anything!`,
          timestamp: new Date()
        }
      ]);
    }, { allowSignalWrites: true });
  }

  ngAfterViewChecked(): void {
    this.scrollToBottom();
  }

  sendMessage(text?: string): void {
    const msg = text || this.inputControl.value?.trim();
    if (!msg || this.isThinking()) return;

    const userMessage: AIMessage = {
      id: String(Date.now()),
      role: 'user',
      content: msg,
      timestamp: new Date()
    };

    this.messages.update((m) => [...m, userMessage]);
    this.inputControl.reset();
    
    const textarea = document.getElementById('ai-input') as HTMLTextAreaElement;
    this.resetTextareaHeight(textarea);

    this.aiService.sendMessage(msg, this.context()).subscribe({
      next: (response) => {
        this.messages.update((m) => [...m, response]);
      },
      error: (err) => {
        const errorMsg = err.message || 'AI request failed.';
        const errMessageObj: AIMessage = {
          id: String(Date.now()),
          role: 'assistant',
          content: `⚠️ **AI Error**: ${errorMsg}`,
          timestamp: new Date(),
          isError: true,
          errorCode: err.code
        };
        this.messages.update((m) => [...m, errMessageObj]);
        this.notifService.show(errorMsg, 'error');
      }
    });
  }

  clearChat(): void {
    this.aiService.clearConversation().subscribe({
      next: () => {
        this.messages.set([
          {
            id: '0',
            role: 'assistant',
            content: `Hello! I'm DevPilot AI. I can help you:\n\n- **Explain** your code\n- **Fix** bugs and errors\n- **Generate** tests, docs, and boilerplate\n- **Refactor** for best practices\n\nSelect code in the editor or just ask me anything!`,
            timestamp: new Date()
          }
        ]);
        this.notifService.show('Conversation cleared.', 'info');
      },
      error: () => {
        this.messages.set([]);
      }
    });
  }

  toggleQuickActions(): void {
    this.quickActionsExpanded.set(!this.quickActionsExpanded());
  }

  onKeydown(e: KeyboardEvent): void {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      this.sendMessage();
      this.resetTextareaHeight(e.target as HTMLTextAreaElement);
    }
  }

  autoResize(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    textarea.style.height = 'auto';
    textarea.style.height = textarea.scrollHeight + 'px';
  }

  private resetTextareaHeight(textarea: HTMLTextAreaElement): void {
    if (textarea) {
      textarea.style.height = 'auto';
    }
  }

  private scrollToBottom(): void {
    try {
      this.messagesEnd?.nativeElement?.scrollIntoView({ behavior: 'smooth' });
    } catch { /* ignore */ }
  }

  formatContent(content: string): string {
    return content
      .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/```(\w*)\n?([\s\S]*?)```/g, '<pre class="devpilot-ai__code-block"><code>$2</code></pre>')
      .replace(/\n/g, '<br>');
  }

  getSelectedLineCount(): number {
    const code = this.context().selectedCode || '';
    if (!code) return 0;
    return code.split('\n').length;
  }

  toggleDiff(key: string): void {
    this.expandedDiffs.update(map => ({
      ...map,
      [key]: !map[key]
    }));
  }

  isDiffExpanded(key: string): boolean {
    return !!this.expandedDiffs()[key];
  }

  /**
   * Generates line-by-line diff between originalContent and proposed content
   */
  getDiffLines(change: AIProposedChange): DiffLine[] {
    const oldLines = change.originalContent ? change.originalContent.split('\n') : [];
    const newLines = change.content ? change.content.split('\n') : [];

    if (oldLines.length === 0) {
      // Pure creation
      return newLines.map((l, idx) => ({
        type: 'added',
        text: l,
        newLine: idx + 1
      }));
    }

    const m = oldLines.length;
    const n = newLines.length;

    // Use DP for LCS diff
    const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = 0; i < m; i++) {
      for (let j = 0; j < n; j++) {
        if (oldLines[i] === newLines[j]) {
          dp[i + 1][j + 1] = dp[i][j] + 1;
        } else {
          dp[i + 1][j + 1] = Math.max(dp[i + 1][j], dp[i][j + 1]);
        }
      }
    }

    const diff: DiffLine[] = [];
    let i = m, j = n;
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && oldLines[i - 1] === newLines[j - 1]) {
        diff.unshift({ type: 'unchanged', text: oldLines[i - 1], oldNum: i, newNum: j });
        i--;
        j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        diff.unshift({ type: 'added', text: newLines[j - 1], newNum: j });
        j--;
      } else if (i > 0 && (j === 0 || dp[i][j - 1] < dp[i - 1][j])) {
        diff.unshift({ type: 'removed', text: oldLines[i - 1], oldNum: i });
        i--;
      }
    }

    return diff;
  }

  /**
   * Applies approved changes to real filesystem
   */
  applyChanges(msg: AIMessage): void {
    if (!msg.proposal || this.isApplyingChange()) return;
    const projId = this.context().projectId;
    if (!projId) {
      this.notifService.show('No active project found to apply changes to.', 'error');
      return;
    }

    this.isApplyingChange.set(true);

    this.aiService.applyChanges(msg.id, projId).subscribe({
      next: (res) => {
        this.isApplyingChange.set(false);
        msg.proposal!.status = 'applied';
        this.notifService.show(res.message || 'Changes applied to real local files.', 'success');

        // Step 6: Refresh DevPilot Explorer
        this.projectService.getProjectFiles(projId).subscribe({
          next: (tree) => {
            this.workspaceService.fileTree.set(tree);
          }
        });

        // Step 6: Refresh affected open Monaco editor tabs
        for (const change of msg.proposal!.changes) {
          const openTab = this.editorService.tabs().find((t) => t.path === change.path);
          if (openTab) {
            if (openTab.dirty) {
              this.notifService.show(`File ${change.path} was updated on disk, but has unsaved editor changes.`, 'info');
            } else {
              this.workspaceService.loadFileContent(change.path, true).then(() => {
                const freshContent = this.workspaceService.fileContents.get(change.path);
                if (freshContent !== undefined) {
                  this.editorService.tabs.update((tabs) =>
                    tabs.map((t) => (t.path === change.path ? { ...t, content: freshContent, dirty: false } : t))
                  );
                }
              });
            }
          }
        }
      },
      error: (err) => {
        this.isApplyingChange.set(false);
        const errMsg = err.error?.message || err.message || 'Failed to apply changes.';
        this.notifService.show(errMsg, 'error');
      }
    });
  }

  /**
   * Rejects proposed changes
   */
  rejectChanges(msg: AIMessage): void {
    if (!msg.proposal || this.isApplyingChange()) return;

    this.aiService.rejectChanges(msg.id).subscribe({
      next: () => {
        msg.proposal!.status = 'rejected';
        this.notifService.show('Changes rejected. Files on disk remain unchanged.', 'info');
      },
      error: (err) => {
        const errMsg = err.error?.message || err.message || 'Failed to reject changes.';
        this.notifService.show(errMsg, 'error');
      }
    });
  }
}
