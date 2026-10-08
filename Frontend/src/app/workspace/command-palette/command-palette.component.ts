import { Component, Output, EventEmitter, signal, HostListener, inject } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ReactiveFormsModule, FormControl } from '@angular/forms';
import { Router } from '@angular/router';
import { SharedIconsModule } from '../../shared/shared-icons.module';

interface Command {
  id: string;
  label: string;
  category: string;
  icon: string;
  shortcut?: string;
}

const ALL_COMMANDS: Command[] = [
  { id: 'new-project', label: 'Create Project', category: 'Projects', icon: 'zap' },
  { id: 'open-dashboard', label: 'Open Dashboard', category: 'Navigation', icon: 'home' },
  { id: 'open-docs', label: 'Open Documentation', category: 'Navigation', icon: 'file-text' },
  { id: 'open-deployments', label: 'Open Deployments', category: 'Navigation', icon: 'rocket' },
  { id: 'toggle-ai', label: 'Toggle AI Panel', category: 'View', icon: 'bot' },
  { id: 'toggle-terminal', label: 'Toggle Terminal', category: 'View', icon: 'terminal', shortcut: 'Ctrl+`' },
  { id: 'toggle-theme', label: 'Toggle Theme', category: 'Appearance', icon: 'moon' },
  { id: 'gen-docs', label: 'Generate Documentation', category: 'AI', icon: 'sparkles' },
  { id: 'deploy', label: 'Deploy Project', category: 'Deployment', icon: 'rocket' },
  { id: 'git-push', label: 'Push Changes', category: 'Git', icon: 'arrow-up' },
  { id: 'search-files', label: 'Quick Open File', category: 'Files', icon: 'folder', shortcut: 'Ctrl+P' },
  { id: 'settings', label: 'Open Settings', category: 'Settings', icon: 'settings' }
];

@Component({
  selector: 'app-command-palette',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, SharedIconsModule],
  templateUrl: './command-palette.component.html',
  styleUrl: './command-palette.component.css'
})
export class CommandPaletteComponent {
  @Output() closed = new EventEmitter<void>();

  private router = inject(Router);

  readonly query = new FormControl('');
  readonly selectedIndex = signal(0);

  get filteredCommands(): Command[] {
    const q = (this.query.value || '').toLowerCase();
    if (!q) return ALL_COMMANDS;
    return ALL_COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(q) || c.category.toLowerCase().includes(q)
    );
  }

  close(): void { this.closed.emit(); }

  execute(cmd: Command): void {
    switch (cmd.id) {
      case 'open-dashboard': this.router.navigate(['/dashboard']); break;
      case 'open-docs': this.router.navigate(['/documentation']); break;
      case 'open-deployments': this.router.navigate(['/deployments']); break;
    }
    this.close();
  }

  @HostListener('document:keydown', ['$event'])
  onKey(e: KeyboardEvent): void {
    const cmds = this.filteredCommands;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex.update((i) => Math.min(i + 1, cmds.length - 1));
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex.update((i) => Math.max(i - 1, 0));
    }
    if (e.key === 'Enter') {
      const cmd = cmds[this.selectedIndex()];
      if (cmd) this.execute(cmd);
    }
  }
}
