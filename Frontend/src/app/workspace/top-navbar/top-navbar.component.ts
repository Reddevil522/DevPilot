import { Component, inject, signal, HostListener, Output, EventEmitter } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Router, RouterLink } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';
import { AuthService } from '../../core/services/auth.service';
import { ProjectService } from '../../core/services/project.service';
import { AiService } from '../../core/services/ai.service';
import { NotificationService } from '../../core/services/notification.service';
import { SharedIconsModule } from '../../shared/shared-icons.module';

interface AppNotification {
  id: number;
  icon: string;
  message: string;
  time: string;
  read: boolean;
}

const MOCK_NOTIFICATIONS: AppNotification[] = [
  { id: 1, icon: 'check-circle', message: 'Deployment successful', time: '2 min ago', read: false },
  { id: 2, icon: 'file-text', message: 'AI documentation generated', time: '10 min ago', read: false },
  { id: 3, icon: 'arrow-up', message: 'Git push completed', time: '30 min ago', read: true },
  { id: 4, icon: 'settings', message: 'Build completed successfully', time: '1 hour ago', read: true }
];

@Component({
  selector: 'app-top-navbar',
  standalone: true,
  imports: [CommonModule, RouterLink, SharedIconsModule],
  templateUrl: './top-navbar.component.html',
  styleUrl: './top-navbar.component.css'
})
export class TopNavbarComponent {
  @Output() toggleSidebar = new EventEmitter<void>();
  @Output() searchOpened = new EventEmitter<void>();

  private themeService = inject(ThemeService);
  private authService = inject(AuthService);
  private router = inject(Router);

  readonly projectService = inject(ProjectService);
  readonly notifService = inject(NotificationService);
  readonly aiService = inject(AiService);

  readonly theme = this.themeService.theme;
  readonly currentUser = this.authService.currentUser;

  readonly profileOpen = signal(false);
  readonly notifOpen = signal(false);
  readonly projectSwitcherOpen = signal(false);

  readonly notifications = signal<AppNotification[]>([...MOCK_NOTIFICATIONS]);
  readonly unreadCount = signal(MOCK_NOTIFICATIONS.filter((n) => !n.read).length);

  toggleTheme(): void { this.themeService.toggle(); }

  toggleAiPanel(): void {
    this.aiService.togglePanel();
  }

  toggleProfile(): void {
    this.profileOpen.update((v) => !v);
    this.notifOpen.set(false);
    this.projectSwitcherOpen.set(false);
  }

  toggleNotif(): void {
    this.notifOpen.update((v) => !v);
    this.profileOpen.set(false);
    this.projectSwitcherOpen.set(false);
  }

  toggleProjectSwitcher(): void {
    this.projectSwitcherOpen.update((v) => !v);
    this.profileOpen.set(false);
    this.notifOpen.set(false);
  }

  markAllRead(): void {
    this.notifications.update((list) => list.map((n) => ({ ...n, read: true })));
    this.unreadCount.set(0);
  }

  clearNotifications(): void {
    this.notifications.set([]);
    this.unreadCount.set(0);
    this.notifOpen.set(false);
  }

  openSearch(): void {
    this.searchOpened.emit();
  }

  logout(): void {
    this.authService.logout().subscribe({
      next: () => this.router.navigate(['/login']),
      error: () => this.router.navigate(['/login'])
    });
    this.profileOpen.set(false);
  }

  getUserInitials(name: string | undefined | null): string {
    if (!name) return 'U';
    return name.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(e: Event): void {
    const target = e.target as HTMLElement;
    if (!target.closest('.devpilot-navbar__profile-wrap')) this.profileOpen.set(false);
    if (!target.closest('.devpilot-navbar__notif-wrap')) this.notifOpen.set(false);
    if (!target.closest('.devpilot-navbar__breadcrumb')) this.projectSwitcherOpen.set(false);
  }
}
