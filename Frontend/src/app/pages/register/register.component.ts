import { Component, computed, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink } from '@angular/router';
import {
  AbstractControl,
  FormBuilder,
  ReactiveFormsModule,
  ValidationErrors,
  Validators
} from '@angular/forms';
import { BackgroundComponent } from '../../components/background/background.component';
import { AuthSideComponent } from '../../components/auth-side/auth-side.component';
import { LogoComponent } from '../../components/logo/logo.component';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';

function passwordsMatchValidator(control: AbstractControl): ValidationErrors | null {
  const password = control.get('password')?.value;
  const confirm = control.get('confirmPassword')?.value;
  if (!password || !confirm) {
    return null;
  }
  return password === confirm ? null : { mismatch: true };
}

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, BackgroundComponent, AuthSideComponent, LogoComponent],
  templateUrl: './register.component.html',
  styleUrl: './register.component.css'
})
export class RegisterComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private notifService = inject(NotificationService);

  readonly passwordVisible = signal(false);
  readonly confirmVisible = signal(false);
  readonly isSubmitting = signal(false);
  readonly submittedOk = signal(false);
  private passwordValue = signal('');

  readonly form = this.fb.group(
    {
      fullName: ['', [Validators.required, Validators.minLength(2)]],
      email: ['', [Validators.required, Validators.email]],
      password: ['', [Validators.required, Validators.minLength(8)]],
      confirmPassword: ['', [Validators.required]],
      agreeTerms: [false, [Validators.requiredTrue]]
    },
    { validators: passwordsMatchValidator }
  );

  readonly passwordStrength = computed(() => this.scorePassword(this.passwordValue()));

  constructor() {
    this.form.controls.password.valueChanges.subscribe(() =>
      this.passwordValue.set(this.form.controls.password.value || '')
    );
  }

  togglePassword(): void {
    this.passwordVisible.update((v) => !v);
  }

  toggleConfirm(): void {
    this.confirmVisible.update((v) => !v);
  }

  get fullName() {
    return this.form.controls.fullName;
  }

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  get confirmPassword() {
    return this.form.controls.confirmPassword;
  }

  get agreeTerms() {
    return this.form.controls.agreeTerms;
  }

  get passwordsMismatch(): boolean {
    return !!this.form.errors?.['mismatch'] && this.confirmPassword.touched;
  }

  onSubmit(): void {
    this.submittedOk.set(false);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    const { fullName, email, password, confirmPassword } = this.form.getRawValue();

    this.auth
      .register({ name: fullName!, email: email!, password: password!, confirmPassword: confirmPassword! })
      .subscribe({
        next: (result) => {
          this.isSubmitting.set(false);
          if (result.success) {
            this.submittedOk.set(true);
            this.notifService.show('Account created successfully. Redirecting...', 'success');
          } else {
            this.notifService.show(result.message ?? 'Unknown error occurred.', 'error');
          }
        },
        error: (err) => {
          this.isSubmitting.set(false);
          this.notifService.show(err.message || 'Something went wrong. Please try again.', 'error');
        }
      });
  }

  private scorePassword(value: string): { label: string; score: number } {
    if (!value) {
      return { label: '', score: 0 };
    }
    let score = 0;
    if (value.length >= 8) score++;
    if (value.length >= 12) score++;
    if (/[A-Z]/.test(value) && /[a-z]/.test(value)) score++;
    if (/[0-9]/.test(value)) score++;
    if (/[^A-Za-z0-9]/.test(value)) score++;

    if (score <= 1) return { label: 'Weak', score: 1 };
    if (score <= 3) return { label: 'Medium', score: 2 };
    return { label: 'Strong', score: 3 };
  }
}
