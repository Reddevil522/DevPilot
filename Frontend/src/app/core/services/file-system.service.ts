import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, map } from 'rxjs';

export interface FileEvent {
  type: 'CREATE' | 'UPDATE' | 'DELETE' | 'CREATE_FOLDER' | 'DELETE_FOLDER' | 'CONNECTED';
  path?: string;
  message?: string;
  timestamp: number;
}

@Injectable({
  providedIn: 'root'
})
export class FileSystemService {
  private http = inject(HttpClient);
  private apiUrl = 'http://localhost:5000/api/projects';

  readFile(projectId: string, path: string): Observable<string> {
    return this.http.get<{success: boolean, data: string}>(
      `${this.apiUrl}/${projectId}/fs?path=${encodeURIComponent(path)}`,
      { withCredentials: true }
    ).pipe(map(res => res.data));
  }

  writeFile(projectId: string, path: string, content: string): Observable<void> {
    return this.http.put<void>(
      `${this.apiUrl}/${projectId}/fs`,
      { path, content },
      { withCredentials: true }
    );
  }

  createFile(projectId: string, path: string, content: string = ''): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/${projectId}/fs`,
      { path, content },
      { withCredentials: true }
    );
  }

  createFolder(projectId: string, path: string): Observable<void> {
    return this.http.post<void>(
      `${this.apiUrl}/${projectId}/fs/folder`,
      { path },
      { withCredentials: true }
    );
  }

  deletePath(projectId: string, path: string, isFolder: boolean): Observable<void> {
    return this.http.delete<void>(
      `${this.apiUrl}/${projectId}/fs?path=${encodeURIComponent(path)}&isFolder=${isFolder}`,
      { withCredentials: true }
    );
  }

  renamePath(projectId: string, oldPath: string, newPath: string): Observable<void> {
    return this.http.patch<void>(
      `${this.apiUrl}/${projectId}/fs/rename`,
      { oldPath, newPath },
      { withCredentials: true }
    );
  }

  // SSE stream
  watchProject(projectId: string): Observable<FileEvent> {
    return new Observable<FileEvent>(observer => {
      const eventSource = new EventSource(`${this.apiUrl}/${projectId}/watch`, {
        withCredentials: true
      });

      eventSource.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          observer.next(data as FileEvent);
        } catch (e) {
          console.warn('Failed to parse SSE watcher event:', e);
        }
      };

      eventSource.onerror = (error) => {
        console.error('SSE Watcher Error:', error);
        observer.error(error);
        eventSource.close();
      };

      return () => {
        eventSource.close();
      };
    });
  }
}
