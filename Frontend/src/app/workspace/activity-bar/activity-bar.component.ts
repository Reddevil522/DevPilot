import { Component, Output, EventEmitter, signal, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

export type ActivityItem =
  | 'explorer'
  | 'search'
  | 'projects'
  | 'source-control'
  | 'ai'
  | 'documentation'
  | 'deployment'
  | 'extensions'
  | 'settings';

@Component({
  selector: 'app-activity-bar',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './activity-bar.component.html',
  styleUrl: './activity-bar.component.css'
})
export class ActivityBarComponent {
  @Input() activeItem: ActivityItem = 'explorer';
  @Output() activityChange = new EventEmitter<ActivityItem>();

  readonly topItems: { id: ActivityItem; label: string; icon: string }[] = [
    { id: 'explorer', label: 'Explorer', icon: 'files' },
    { id: 'search', label: 'Search', icon: 'search' },
    { id: 'projects', label: 'Projects', icon: 'grid' },
    { id: 'source-control', label: 'Source Control', icon: 'git' },
    { id: 'ai', label: 'AI Assistant', icon: 'ai' },
    { id: 'documentation', label: 'Documentation', icon: 'docs' },
    { id: 'deployment', label: 'Deployment', icon: 'deploy' },
    { id: 'extensions', label: 'Extensions', icon: 'extensions' }
  ];

  readonly bottomItems: { id: ActivityItem; label: string; icon: string }[] = [
    { id: 'settings', label: 'Settings', icon: 'settings' }
  ];

  select(id: ActivityItem): void {
    this.activityChange.emit(id);
  }
}
