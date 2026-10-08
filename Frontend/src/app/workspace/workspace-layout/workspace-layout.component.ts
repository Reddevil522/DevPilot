import { Component, signal, inject, HostListener } from '@angular/core';
import { CommonModule } from '@angular/common';
import { RouterOutlet } from '@angular/router';
import { TopNavbarComponent } from '../top-navbar/top-navbar.component';
import { ActivityBarComponent, ActivityItem } from '../activity-bar/activity-bar.component';

import { ExplorerComponent } from '../explorer/explorer.component';
import { SourceControlComponent } from '../source-control/source-control.component';
import { CommandPaletteComponent } from '../command-palette/command-palette.component';
import { ToastComponent } from '../../shared/components/toast/toast.component';
import { ProjectService } from '../../core/services/project.service';

@Component({
  selector: 'app-workspace-layout',
  standalone: true,
  imports: [
    CommonModule,
    RouterOutlet,
    TopNavbarComponent,
    ActivityBarComponent,

    ExplorerComponent,
    SourceControlComponent,
    CommandPaletteComponent,
    ToastComponent
  ],
  templateUrl: './workspace-layout.component.html',
  styleUrl: './workspace-layout.component.css'
})
export class WorkspaceLayoutComponent {
  readonly projectService = inject(ProjectService);
  readonly activeActivity = signal<ActivityItem>('explorer');
  readonly sidebarVisible = signal(true);
  readonly commandPaletteOpen = signal(false);

  onActivityChange(item: ActivityItem): void {
    if (this.activeActivity() === item && this.sidebarVisible()) {
      this.sidebarVisible.set(false);
    } else {
      this.activeActivity.set(item);
      this.sidebarVisible.set(true);
    }
  }

  toggleSidebar(): void {
    this.sidebarVisible.update((v) => !v);
  }

  openCommandPalette(): void {
    this.commandPaletteOpen.set(true);
  }

  closeCommandPalette(): void {
    this.commandPaletteOpen.set(false);
  }

  @HostListener('document:keydown', ['$event'])
  onKeydown(e: KeyboardEvent): void {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      this.commandPaletteOpen.update((v) => !v);
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'b') {
      e.preventDefault();
      this.toggleSidebar();
    }
    if (e.key === 'Escape' && this.commandPaletteOpen()) {
      this.commandPaletteOpen.set(false);
    }
  }
}
