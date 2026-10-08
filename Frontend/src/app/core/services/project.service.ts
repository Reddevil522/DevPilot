import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, from, of, switchMap, catchError, map, tap } from 'rxjs';
import {
  Project,
  CreateProjectPayload,
  FileNode,
} from '../../shared/models/project.model';


@Injectable({ providedIn: 'root' })
export class ProjectService {
  private http = inject(HttpClient);
  
  readonly activeProject = signal<Project | null>(null);
  readonly isLoading = signal(false);
  readonly isCreating = signal(false);

  private apiUrl = 'http://localhost:5000/api/projects';

  getProjects(): Observable<Project[]> {
    this.isLoading.set(true);
    return this.http.get<{success: boolean, data: Project[]}>(this.apiUrl, { withCredentials: true }).pipe(
      map(response => response.data),
      tap(() => this.isLoading.set(false)),
      catchError(() => {
        this.isLoading.set(false);
        return of([]);
      })
    );
  }

  getProject(id: string): Observable<Project | undefined> {
    return this.http.get<{success: boolean, data: Project}>(`${this.apiUrl}/${id}`, { withCredentials: true }).pipe(
      map(response => response.data),
      catchError(() => of(undefined))
    );
  }

  getProjectFiles(id: string): Observable<FileNode[]> {
    return this.http.get<{success: boolean, data: FileNode[]}>(`${this.apiUrl}/${id}/files`, { withCredentials: true }).pipe(
      map(response => response.data),
      catchError(error => {
        console.error('Failed to load project files:', error);
        return of([]);
      })
    );
  }

  createProject(payload: CreateProjectPayload): Observable<Project> {
    this.isCreating.set(true);
    return this.http.post<{success: boolean, data: Project}>(this.apiUrl, payload, { withCredentials: true }).pipe(
      map(response => response.data),
      tap(project => {
        this.isCreating.set(false);
        this.activeProject.set(project);
      }),
      catchError(error => {
        this.isCreating.set(false);
        throw error;
      })
    );
  }

  createProjectWithProgress(payload: CreateProjectPayload): Observable<any> {
    this.isCreating.set(true);
    return new Observable(observer => {
      // For cloud projects or simple creation, fallback to normal HTTP post if no progress stream is needed
      if (payload.projectType === 'cloud') {
        this.createProject(payload).subscribe({
          next: p => {
            observer.next({ type: 'progress', message: 'Setting up cloud resources...' });
            observer.next({ type: 'complete', project: p });
            observer.complete();
          },
          error: e => observer.error(e)
        });
        return;
      }

      // For local projects, use fetch API to consume SSE stream manually
      // We pass the payload via query params or a POST request.
      // Since EventSource doesn't support POST with body or custom headers easily,
      // we can use the fetch API to read the stream.
      
      const abortController = new AbortController();
      
      fetch(`${this.apiUrl}/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload),
        signal: abortController.signal,
        credentials: 'include'
      }).then(async (response) => {
        if (!response.ok) {
          const errText = await response.text();
          throw new Error(`Failed to create project: ${response.statusText} - ${errText}`);
        }
        
        const reader = response.body?.getReader();
        if (!reader) throw new Error("Stream not supported");
        
        const decoder = new TextDecoder();
        let buffer = '';
        
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          
          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split('\n\n');
          buffer = lines.pop() || ''; // Keep the incomplete part
          
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              const dataStr = line.substring(6);
              try {
                const data = JSON.parse(dataStr);
                observer.next(data);
                
                if (data.type === 'complete') {
                  this.isCreating.set(false);
                  if (data.project) {
                    this.activeProject.set(data.project);
                  }
                  observer.complete();
                  return;
                } else if (data.type === 'error') {
                  this.isCreating.set(false);
                  observer.error(new Error(data.message));
                  return;
                }
              } catch (e) {
                console.warn('Failed to parse SSE data', dataStr);
              }
            }
          }
        }
        observer.complete();
      }).catch(err => {
        this.isCreating.set(false);
        observer.error(err);
      });

      return () => {
        abortController.abort();
      };
    });
  }

  updateProject(id: string, updates: Partial<Project>): Observable<Project> {
    return this.http.patch<{success: boolean, data: Project}>(`${this.apiUrl}/${id}`, updates, { withCredentials: true }).pipe(
      map(response => response.data)
    );
  }

  deleteProject(id: string): Observable<{ success: boolean }> {
    return this.http.delete<{success: boolean}>(`${this.apiUrl}/${id}`, { withCredentials: true }).pipe(
      map(response => response)
    );
  }

  setActiveProject(project: Project): void {
    this.activeProject.set(project);
  }
}
