import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, throwError, of } from 'rxjs';
import { map, catchError, finalize, delay } from 'rxjs/operators';
import {
  AIMessage,
  AIContext,
  DocumentationType,
  DocTypeOption,
  GenerateDocRequest,
  ReviseDocRequest,
  SaveDocToProjectRequest,
  GeneratedDocument
} from '../../shared/models/ai.model';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class AiService {
  private http = inject(HttpClient);
  private apiUrl = `${environment.apiUrl}/ai`;

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
  sendMessage(message: string, currentContext: AIContext, operation?: string): Observable<AIMessage> {
    this.isThinking.set(true);

    const payload = {
      message,
      operation: operation || 'chat',
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
          errorMsg = 'Cannot reach DevPilot backend server. Please verify network connectivity and backend status.';
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
   * Sends a chat message with end-to-end SSE streaming for sub-second TTFT.
   */
  sendMessageStream(
    message: string,
    currentContext: AIContext,
    operation?: string
  ): Observable<{ type: 'chunk' | 'proposal' | 'completed'; content?: string; proposal?: any; message?: AIMessage }> {
    this.isThinking.set(true);

    const payload = {
      message,
      operation: operation || 'chat',
      projectId: currentContext.projectId || undefined,
      conversationId: this.currentConversationId() || undefined,
      activeFilePath: currentContext.currentFile || undefined,
      selectedCode: currentContext.selectedCode || undefined,
      errorContext: currentContext.errorContext || undefined
    };

    return new Observable((subscriber) => {
      const controller = new AbortController();

      fetch(`${this.apiUrl}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        credentials: 'include',
        body: JSON.stringify(payload),
        signal: controller.signal
      })
        .then(async (response) => {
          if (!response.ok) {
            let errorMsg = 'AI request failed.';
            let code = 'STREAM_ERROR';
            try {
              const errJson = await response.json();
              errorMsg = errJson.message || errorMsg;
              code = errJson.code || code;
            } catch {
              errorMsg = `Server returned HTTP ${response.status}: ${response.statusText}`;
            }
            subscriber.error({ message: errorMsg, code, status: response.status });
            return;
          }

          if (!response.body) {
            subscriber.error({ message: 'No response body stream received.', code: 'NO_STREAM' });
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder('utf-8');
          let buffer = '';

          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;

              buffer += decoder.decode(value, { stream: true });
              const parts = buffer.split('\n\n');
              buffer = parts.pop() || '';

              for (const part of parts) {
                const line = part.trim();
                if (line.startsWith('data: ')) {
                  try {
                    const data = JSON.parse(line.slice(6));
                    if (data.type === 'chunk') {
                      subscriber.next({ type: 'chunk', content: data.content });
                    } else if (data.type === 'proposal') {
                      subscriber.next({ type: 'proposal', proposal: data.proposal });
                    } else if (data.type === 'completed') {
                      if (data.conversationId) {
                        this.currentConversationId.set(data.conversationId);
                      }
                      const msg: AIMessage = {
                        id: data.message?.id || String(Date.now()),
                        role: data.message?.role || 'assistant',
                        content: data.message?.content || '',
                        timestamp: data.message?.timestamp ? new Date(data.message.timestamp) : new Date(),
                        proposal: data.message?.proposal || null
                      };
                      subscriber.next({ type: 'completed', message: msg });
                    } else if (data.type === 'error') {
                      subscriber.error({ message: data.message || 'Stream error', code: data.code || 'STREAM_ERROR' });
                      return;
                    }
                  } catch {
                    // Ignore parse error on incomplete chunks
                  }
                }
              }
            }
            subscriber.complete();
          } finally {
            reader.releaseLock();
          }
        })
        .catch((err) => {
          if (err.name === 'AbortError') {
            subscriber.complete();
            return;
          }
          let errorMsg = err.message || 'Network error occurred.';
          if (err.message?.includes('Failed to fetch') || err.message?.includes('NetworkError')) {
            errorMsg = 'Cannot reach DevPilot backend server. Please verify network connectivity and backend status.';
          }
          subscriber.error({ message: errorMsg, code: 'NETWORK_ERROR' });
        })
        .finally(() => {
          this.isThinking.set(false);
        });

      return () => {
        controller.abort();
        this.isThinking.set(false);
      };
    });
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

    return this.http.post<{ success: boolean; data: { content: string; proposal?: any } }>(
      `${this.apiUrl}/generate-docs`,
      { projectId, docType: type },
      { withCredentials: true }
    ).pipe(
      map(res => res.data?.content || ''),
      catchError((error: HttpErrorResponse) => {
        let errorMsg = 'Failed to generate documentation.';
        if (error.error?.message) {
          errorMsg = error.error.message;
        }
        return throwError(() => ({ message: errorMsg, status: error.status }));
      }),
      finalize(() => this.isThinking.set(false))
    );
  }

  /**
   * Retrieves supported document types and metadata options
   */
  getDocumentTypes(): Observable<DocTypeOption[]> {
    return this.http.get<{ success: boolean; data: DocTypeOption[] }>(
      `${this.apiUrl}/docs/types`,
      { withCredentials: true }
    ).pipe(
      map(res => res.data || []),
      catchError((error: HttpErrorResponse) => {
        const errorMsg = error.error?.message || 'Failed to load document types.';
        return throwError(() => ({ message: errorMsg, status: error.status }));
      })
    );
  }

  /**
   * Generates a complete document using the real local Ollama AI model
   */
  generateDoc(payload: GenerateDocRequest): Observable<GeneratedDocument> {
    this.isThinking.set(true);

    return this.http.post<{ success: boolean; data: GeneratedDocument }>(
      `${this.apiUrl}/docs/generate`,
      payload,
      { withCredentials: true }
    ).pipe(
      map(res => res.data),
      catchError((error: HttpErrorResponse) => {
        let errorMsg = 'Failed to generate document.';
        if (error.status === 0) {
          errorMsg = 'Cannot reach DevPilot backend server. Please verify your connection.';
        } else if (error.error?.message) {
          errorMsg = error.error.message;
        }
        return throwError(() => ({
          message: errorMsg,
          code: error.error?.code || 'GEN_ERROR',
          status: error.status
        }));
      }),
      finalize(() => this.isThinking.set(false))
    );
  }

  /**
   * Revises an existing document or draft using Ollama given a revision prompt
   */
  reviseDoc(payload: ReviseDocRequest): Observable<GeneratedDocument> {
    this.isThinking.set(true);

    return this.http.post<{ success: boolean; data: GeneratedDocument }>(
      `${this.apiUrl}/docs/revise`,
      payload,
      { withCredentials: true }
    ).pipe(
      map(res => res.data),
      catchError((error: HttpErrorResponse) => {
        let errorMsg = 'Failed to revise document.';
        if (error.error?.message) {
          errorMsg = error.error.message;
        }
        return throwError(() => ({
          message: errorMsg,
          code: error.error?.code || 'REVISE_ERROR',
          status: error.status
        }));
      }),
      finalize(() => this.isThinking.set(false))
    );
  }

  /**
   * Gets document history for a project
   */
  getProjectDocuments(projectId: string): Observable<GeneratedDocument[]> {
    return this.http.get<{ success: boolean; data: GeneratedDocument[] }>(
      `${this.apiUrl}/docs/project/${projectId}`,
      { withCredentials: true }
    ).pipe(
      map(res => res.data || []),
      catchError((error: HttpErrorResponse) => {
        const errorMsg = error.error?.message || 'Failed to load project documents.';
        return throwError(() => ({ message: errorMsg, status: error.status }));
      })
    );
  }

  /**
   * Retrieves a specific document by its ID
   */
  getDocument(id: string): Observable<GeneratedDocument> {
    return this.http.get<{ success: boolean; data: GeneratedDocument }>(
      `${this.apiUrl}/docs/${id}`,
      { withCredentials: true }
    ).pipe(
      map(res => res.data),
      catchError((error: HttpErrorResponse) => {
        const errorMsg = error.error?.message || 'Document not found.';
        return throwError(() => ({ message: errorMsg, status: error.status }));
      })
    );
  }

  /**
   * Updates an existing document's title or content in MongoDB
   */
  updateDocument(id: string, payload: { title?: string; content?: string }): Observable<GeneratedDocument> {
    return this.http.put<{ success: boolean; data: GeneratedDocument }>(
      `${this.apiUrl}/docs/${id}`,
      payload,
      { withCredentials: true }
    ).pipe(
      map(res => res.data),
      catchError((error: HttpErrorResponse) => {
        const errorMsg = error.error?.message || 'Failed to update document.';
        return throwError(() => ({ message: errorMsg, status: error.status }));
      })
    );
  }

  /**
   * Deletes a document from MongoDB
   */
  deleteDocument(id: string): Observable<{ success: boolean; message?: string }> {
    return this.http.delete<{ success: boolean; message?: string }>(
      `${this.apiUrl}/docs/${id}`,
      { withCredentials: true }
    ).pipe(
      catchError((error: HttpErrorResponse) => {
        const errorMsg = error.error?.message || 'Failed to delete document.';
        return throwError(() => ({ message: errorMsg, status: error.status }));
      })
    );
  }

  /**
   * Saves a document directly to the local project workspace filesystem
   */
  saveDocToProject(payload: SaveDocToProjectRequest): Observable<{ success: boolean; filePath: string; message: string }> {
    return this.http.post<{ success: boolean; filePath: string; message: string }>(
      `${this.apiUrl}/docs/save`,
      payload,
      { withCredentials: true }
    ).pipe(
      catchError((error: HttpErrorResponse) => {
        const errorMsg = error.error?.message || 'Failed to save document to project filesystem.';
        return throwError(() => ({ message: errorMsg, status: error.status }));
      })
    );
  }

  /**
   * Downloads a generated document as Markdown or HTML
   */
  exportDocument(id: string, format: 'markdown' | 'html' = 'markdown'): Observable<Blob> {
    return this.http.get(
      `${this.apiUrl}/docs/${id}/export?format=${format}`,
      { responseType: 'blob', withCredentials: true }
    );
  }

  /**
   * Exports arbitrary document content on the fly as Markdown or HTML
   */
  exportContentDirect(content: string, format: 'markdown' | 'html' = 'markdown', filename?: string): Observable<Blob> {
    return this.http.post(
      `${this.apiUrl}/docs/export`,
      { content, format, filename },
      { responseType: 'blob', withCredentials: true }
    );
  }

  stopThinking(): void {
    this.isThinking.set(false);
  }
}
