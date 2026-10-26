import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { map, catchError, finalize, delay } from 'rxjs/operators';
import { AIMessage, AIContext, DocumentationType } from '../../shared/models/ai.model';

@Injectable({ providedIn: 'root' })
export class AiService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:5000/api/ai';

  readonly isThinking = signal(false);
  readonly isPanelOpen = signal(false);
  readonly currentConversationId = signal<string | null>(null);

  readonly context = signal<AIContext>({
    projectName: '',
    projectId: '',
    currentFile: '',
    selectedCode: '',
    errorContext: ''
  });

  /**
   * Sends a real chat message to the DevPilot backend AI endpoint.
   */
  sendMessage(message: string, currentContext: AIContext): Observable<AIMessage> {
    this.isThinking.set(true);

    const payload = {
      message,
      projectId: currentContext.projectId || undefined,
      conversationId: this.currentConversationId() || undefined,
      activeFilePath: currentContext.currentFile || undefined,
      selectedCode: currentContext.selectedCode || undefined,
      errorContext: currentContext.errorContext || undefined
    };

    return this.http.post<{ success: boolean; conversationId: string; message: any }>(
      `${this.apiUrl}/chat`,
      payload,
      { withCredentials: true }
    ).pipe(
      map(res => {
        if (res.conversationId) {
          this.currentConversationId.set(res.conversationId);
        }

        const msg: AIMessage = {
          id: res.message.id || String(Date.now()),
          role: res.message.role || 'assistant',
          content: res.message.content || '',
          timestamp: res.message.timestamp ? new Date(res.message.timestamp) : new Date(),
          proposal: res.message.proposal || null
        };
        return msg;
      }),
      catchError((error: HttpErrorResponse) => {
        let errorMsg = 'AI request failed.';
        let code = 'UNKNOWN_ERROR';

        if (error.status === 0) {
          errorMsg = 'Cannot reach DevPilot backend server (port 5000).';
          code = 'BACKEND_UNREACHABLE';
        } else if (error.error?.message) {
          errorMsg = error.error.message;
          code = error.error.code || 'API_ERROR';
        } else if (error.message) {
          errorMsg = error.message;
        }

        return throwError(() => ({
          message: errorMsg,
          code,
          status: error.status
        }));
      }),
      finalize(() => {
        this.isThinking.set(false);
      })
    );
  }

  /**
   * Applies approved AI proposed changes to real files on the local filesystem.
   */
  applyChanges(messageId: string, projectId: string): Observable<{ success: boolean; appliedFiles: string[]; message: string }> {
    const conversationId = this.currentConversationId();
    return this.http.post<{ success: boolean; appliedFiles: string[]; message: string }>(
      `${this.apiUrl}/apply-changes`,
      { conversationId, messageId, projectId },
      { withCredentials: true }
    );
  }

  /**
   * Rejects proposed AI file changes. Real files on disk remain untouched.
   */
  rejectChanges(messageId: string): Observable<{ success: boolean; message: string }> {
    const conversationId = this.currentConversationId();
    return this.http.post<{ success: boolean; message: string }>(
      `${this.apiUrl}/reject-changes`,
      { conversationId, messageId },
      { withCredentials: true }
    );
  }

  /**
   * Fetches conversation history from backend
   */
  getConversation(conversationId: string): Observable<AIMessage[]> {
    return this.http.get<{ success: boolean; data: any }>(
      `${this.apiUrl}/conversations/${conversationId}`,
      { withCredentials: true }
    ).pipe(
      map(res => {
        const msgs: AIMessage[] = (res.data?.messages || []).map((m: any) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          timestamp: new Date(m.timestamp),
          proposal: m.proposal || null
        }));
        return msgs;
      })
    );
  }

  /**
   * Clears current conversation history on backend and resets conversation ID
   */
  clearConversation(): Observable<void> {
    const convId = this.currentConversationId();
    this.currentConversationId.set(null);
    if (!convId) {
      return new Observable(sub => { sub.next(); sub.complete(); });
    }
    return this.http.delete<void>(
      `${this.apiUrl}/conversations/${convId}`,
      { withCredentials: true }
    );
  }

  /**
   * Resets AI context when switching projects to guarantee no context leakage
   */
  resetProjectContext(project: { id: string; name?: string } | null): void {
    this.currentConversationId.set(null);
    if (project) {
      this.context.set({
        projectId: project.id,
        projectName: project.name || '',
        currentFile: '',
        selectedCode: '',
        errorContext: ''
      });
    } else {
      this.context.set({
        projectId: '',
        projectName: '',
        currentFile: '',
        selectedCode: '',
        errorContext: ''
      });
    }
  }

  updateContext(ctx: Partial<AIContext>): void {
    this.context.update((c) => ({ ...c, ...ctx }));
  }

  togglePanel(): void {
    this.isPanelOpen.update((v) => !v);
  }

  generateDocumentation(projectId: string, type: DocumentationType): Observable<string> {
    this.isThinking.set(true);
    const docs: Record<DocumentationType, string> = {
      readme: `# Project Documentation\n\nA modern application built on DevPilot.\n\n## Quick Start\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\``,
      api: `# API Reference\n\n## Endpoints\n- GET /api/health - Health check\n- POST /api/auth/login - Authentication`,
      code: `# Code Architecture\n\nModular design separating routes, controllers, services, and models.`,
      architecture: `# Architecture Overview\n\nClient (Angular) -> REST API (Node.js/Express) -> Database (MongoDB) + Local Filesystem`,
      deployment: `# Deployment Guide\n\nConfigured for local development and cloud container execution.`
    };

    return of(docs[type] || docs['readme']).pipe(
      delay(1000),
      finalize(() => this.isThinking.set(false))
    );
  }

  stopThinking(): void {
    this.isThinking.set(false);
  }
}
