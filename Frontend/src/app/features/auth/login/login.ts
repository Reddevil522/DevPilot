import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { Router } from '@angular/router';
import { AuthService } from '../../../core/auth/auth.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="login-container">
      <h2>Login to DevPilot</h2>
      <form [formGroup]="loginForm" (ngSubmit)="onSubmit()">
        <div class="form-group">
          <label>Email</label>
          <input type="email" formControlName="email">
          <div *ngIf="loginForm.get('email')?.touched && loginForm.get('email')?.invalid" class="error">
            <span *ngIf="loginForm.get('email')?.errors?.['required']">Email is required</span>
            <span *ngIf="loginForm.get('email')?.errors?.['email']">Must be a valid email</span>
          </div>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" formControlName="password">
          <div *ngIf="loginForm.get('password')?.touched && loginForm.get('password')?.invalid" class="error">
            <span *ngIf="loginForm.get('password')?.errors?.['required']">Password is required</span>
          </div>
        </div>
        <div *ngIf="errorMessage" class="error-alert">{{ errorMessage }}</div>
        <button type="submit" [disabled]="loginForm.invalid || isLoading">
          {{ isLoading ? 'Loading...' : 'Login' }}
        </button>
      </form>
    </div>
  `,
  styles: [`
    .login-container { max-width: 400px; margin: 2rem auto; padding: 2rem; border: 1px solid #ccc; border-radius: 8px; }
    .form-group { margin-bottom: 1rem; }
    input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; }
    .error { color: red; font-size: 0.8rem; margin-top: 0.25rem; }
    .error-alert { color: red; margin-bottom: 1rem; padding: 0.5rem; border: 1px solid red; background: #fff0f0; }
    button { width: 100%; padding: 0.5rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:disabled { background: #ccc; }
  `]
})
export class Login {
  loginForm: FormGroup;
  isLoading = false;
  errorMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.loginForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      password: ['', Validators.required]
    });
  }

  onSubmit() {
    if (this.loginForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';

    this.authService.login(this.loginForm.value).subscribe({
      next: () => {
        this.isLoading = false;
        this.router.navigate(['/dashboard']);
      },
      error: (err: { status: number; }) => {
        this.isLoading = false;
        // Map backend errors
        if (err.status === 401) {
          this.errorMessage = 'Invalid email or password.';
        } else if (err.status === 429) {
          this.errorMessage = 'Too many attempts. Please try again later.';
        } else {
          this.errorMessage = 'Something went wrong. Please try again.';
        }
      }
    });
  }
}
