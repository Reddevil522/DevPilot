import { Injectable, signal, inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, throwError } from 'rxjs';
import { catchError, tap, map, finalize } from 'rxjs/operators';

export interface LoginPayload {
  email: string;
  password: string;
  rememberMe?: boolean;
}

export interface RegisterPayload {
  name: string;
  email: string;
  password: string;
  confirmPassword?: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  role: string;
  isEmailVerified: boolean;
}

export interface AuthResult {
  success: boolean;
  message?: string;
  user?: User;
  errors?: any[];
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private http = inject(HttpClient);
  
  // Hardcoded to match the Node.js backend port for now
  private apiUrl = 'http://localhost:5000/api/auth'; 

  readonly isSubmitting = signal(false);
  readonly currentUser = signal<User | null>(null);
  readonly isInitialized = signal(false);

  /**
   * Initializes the auth service by attempting to fetch the current user
   * using the stored HttpOnly cookies.
   */
  init(): Observable<any> {
    return this.http.get<{ success: boolean, user: User }>(`${this.apiUrl}/me`, { withCredentials: true }).pipe(
      tap({
        next: (res) => {
          if (res.success && res.user) {
            this.currentUser.set(res.user);
          }
          this.isInitialized.set(true);
        },
        error: () => {
          this.currentUser.set(null);
          this.isInitialized.set(true);
        }
      }),
      catchError(() => of(null)) // Catch error so app still boots if unauthenticated
    );
  }

  login(payload: LoginPayload): Observable<AuthResult> {
    this.isSubmitting.set(true);
    return this.http.post<AuthResult>(`${this.apiUrl}/login`, payload, { withCredentials: true }).pipe(
      tap(res => {
        if (res.success && res.user) {
          this.currentUser.set(res.user);
        }
      }),
      catchError(this.handleError),
      finalize(() => this.isSubmitting.set(false))
    );
  }

  register(payload: RegisterPayload): Observable<AuthResult> {
    this.isSubmitting.set(true);
    return this.http.post<AuthResult>(`${this.apiUrl}/register`, payload, { withCredentials: true }).pipe(
      catchError(this.handleError),
      finalize(() => this.isSubmitting.set(false))
    );
  }

  logout(): Observable<AuthResult> {
    return this.http.post<AuthResult>(`${this.apiUrl}/logout`, {}, { withCredentials: true }).pipe(
      tap(() => this.currentUser.set(null)),
      catchError(() => {
        // Even if the server fails, clear local state
        this.currentUser.set(null);
        return of({ success: true, message: 'Logged out locally.' });
      })
    );
  }

  refreshToken(): Observable<any> {
    return this.http.post(`${this.apiUrl}/refresh`, {}, { withCredentials: true });
  }

  forgotPassword(email: string): Observable<AuthResult> {
    this.isSubmitting.set(true);
    return this.http.post<AuthResult>(`${this.apiUrl}/forgot-password`, { email }, { withCredentials: true }).pipe(
      catchError(this.handleError),
      finalize(() => this.isSubmitting.set(false))
    );
  }

  private handleError = (error: HttpErrorResponse): Observable<never> => {
    let errorMessage = 'An unknown error occurred.';
    if (error.status === 0) {
      errorMessage = 'Backend server is unreachable. Please ensure it is running on port 5000.';
    } else if (error.error && error.error.errors && error.error.errors.length > 0) {
      errorMessage = error.error.errors[0].message;
    } else if (error.error && error.error.message) {
      errorMessage = error.error.message;
    } else if (error.message) {
      errorMessage = error.message;
    }
    return throwError(() => ({ success: false, message: errorMessage, errors: error.error?.errors }));
  }
}
