import { Component, inject, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterLink, Router, ActivatedRoute } from '@angular/router';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { BackgroundComponent } from '../../components/background/background.component';
import { AuthSideComponent } from '../../components/auth-side/auth-side.component';
import { LogoComponent } from '../../components/logo/logo.component';
import { AuthService } from '../../core/services/auth.service';
import { NotificationService } from '../../core/services/notification.service';

@Component({
  selector: 'app-login',
  standalone: true,
  imports: [CommonModule, RouterLink, ReactiveFormsModule, BackgroundComponent, AuthSideComponent, LogoComponent],
  templateUrl: './login.component.html',
  styleUrl: './login.component.css'
})
export class LoginComponent {
  private fb = inject(FormBuilder);
  private auth = inject(AuthService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);
  private notifService = inject(NotificationService);

  readonly passwordVisible = signal(false);
  readonly isSubmitting = signal(false);
  readonly submittedOk = signal(false);

  readonly form = this.fb.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(8)]],
    rememberMe: [false]
  });

  togglePassword(): void {
    this.passwordVisible.update((v) => !v);
  }

  get email() {
    return this.form.controls.email;
  }

  get password() {
    return this.form.controls.password;
  }

  onSubmit(): void {
    this.submittedOk.set(false);

    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.isSubmitting.set(true);
    const { email, password, rememberMe } = this.form.getRawValue();

    this.auth
      .login({ email: email!, password: password!, rememberMe: !!rememberMe })
      .subscribe({
        next: (result) => {
          this.isSubmitting.set(false);
          if (result.success) {
            this.submittedOk.set(true);
            this.notifService.show('Signed in successfully. Redirecting to your workspace...', 'success');
            const returnUrl = this.route.snapshot.queryParams['returnUrl'] || '/dashboard';
            this.router.navigateByUrl(returnUrl);
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
}
