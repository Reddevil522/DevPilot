import { Component, Input, Output, EventEmitter, inject, signal, ViewChild, ElementRef, AfterViewChecked } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { AiService } from '../../core/services/ai.service';
import { AIMessage } from '../../shared/models/ai.model';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

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

  readonly quickActions = [
    { label: 'Explain Code', icon: 'lightbulb', prompt: 'Explain this code' },
    { label: 'Fix Error', icon: 'wrench', prompt: 'Fix the error in this code' },
    { label: 'Generate Code', icon: 'zap', prompt: 'Generate code for this feature' },
    { label: 'Refactor', icon: 'refresh-cw', prompt: 'Refactor this code to be cleaner' },
    { label: 'Write Tests', icon: 'flask-conical', prompt: 'Write unit tests for this function' },
    { label: 'Generate Docs', icon: 'file-text', prompt: 'Generate documentation for this code' }
  ];

  readonly quickActionsExpanded = signal(true);

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

    this.aiService.isThinking.set(true);

    this.aiService.sendMessage(msg, this.context()).subscribe({
      next: (response) => {
        this.aiService.isThinking.set(false);
        this.messages.update((m) => [...m, response]);
      },
      error: () => {
        this.aiService.isThinking.set(false);
        this.notifService.show('AI request failed. Please try again.', 'error');
      }
    });
  }

  clearChat(): void {
    this.messages.set([]);
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
}
