import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { AuthService } from '../../../core/auth/auth.service';

export function passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password');
  const confirmPassword = control.get('confirmPassword');
  return password && confirmPassword && password.value !== confirmPassword.value ? { 'mismatch': true } : null;
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="register-container">
      <h2>Register for DevPilot</h2>
      <form [formGroup]="registerForm" (ngSubmit)="onSubmit()">
        <div class="form-group">
          <label>Name</label>
          <input type="text" formControlName="name">
          <div *ngIf="registerForm.get('name')?.touched && registerForm.get('name')?.invalid" class="error">
            Required, min 2 chars.
          </div>
        </div>
        <div class="form-group">
          <label>Email</label>
          <input type="email" formControlName="email">
          <div *ngIf="registerForm.get('email')?.touched && registerForm.get('email')?.invalid" class="error">
            Valid email is required.
          </div>
        </div>
        <div class="form-group">
          <label>Password</label>
          <input type="password" formControlName="password">
          <div *ngIf="registerForm.get('password')?.touched && registerForm.get('password')?.invalid" class="error">
            Password must be at least 8 characters long and include an uppercase, lowercase, number, and special character.
          </div>
        </div>
        <div class="form-group">
          <label>Confirm Password</label>
          <input type="password" formControlName="confirmPassword">
          <div *ngIf="registerForm.hasError('mismatch') && registerForm.get('confirmPassword')?.touched" class="error">
            Passwords do not match.
          </div>
        </div>
        <div *ngIf="errorMessage" class="error-alert">{{ errorMessage }}</div>
        <div *ngIf="successMessage" class="success-alert">{{ successMessage }}</div>
        
        <button type="submit" [disabled]="registerForm.invalid || isLoading">
          {{ isLoading ? 'Loading...' : 'Register' }}
        </button>
      </form>
    </div>
  `,
  styles: [`
    .register-container { max-width: 400px; margin: 2rem auto; padding: 2rem; border: 1px solid #ccc; border-radius: 8px; }
    .form-group { margin-bottom: 1rem; }
    input { width: 100%; padding: 0.5rem; margin-top: 0.25rem; }
    .error { color: red; font-size: 0.8rem; margin-top: 0.25rem; }
    .error-alert { color: red; margin-bottom: 1rem; padding: 0.5rem; border: 1px solid red; background: #fff0f0; }
    .success-alert { color: green; margin-bottom: 1rem; padding: 0.5rem; border: 1px solid green; background: #f0fff0; }
    button { width: 100%; padding: 0.5rem; background: #007bff; color: white; border: none; border-radius: 4px; cursor: pointer; }
    button:disabled { background: #ccc; }
  `]
})
export class Register {
  registerForm: FormGroup;
  isLoading = false;
  errorMessage = '';
  successMessage = '';

  constructor(
    private fb: FormBuilder,
    private authService: AuthService
  ) {
    this.registerForm = this.fb.group({
      name: ['', [Validators.required, Validators.minLength(2), Validators.maxLength(100)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [
        Validators.required, 
        Validators.minLength(8), 
        Validators.pattern(/(?=.*[a-z])(?=.*[A-Z])(?=.*[0-9])(?=.*[\W_])/)
      ]],
      confirmPassword: ['', Validators.required]
    }, { validators: passwordMatchValidator });
  }

  onSubmit() {
    if (this.registerForm.invalid) return;

    this.isLoading = true;
    this.errorMessage = '';
    this.successMessage = '';
    
    this.authService.register(this.registerForm.value).subscribe({
      next: (res) => {
        this.isLoading = false;
        this.successMessage = res.message || 'Registration successful!';
        this.registerForm.reset();
      },
      error: (err) => {
        this.isLoading = false;
        if (err.status === 409) {
          this.errorMessage = 'An account with this email may already exist.';
        } else if (err.status === 429) {
          this.errorMessage = 'Too many attempts. Please try again later.';
        } else {
          this.errorMessage = 'Something went wrong. Please try again.';
        }
      }
    });
  }
}
