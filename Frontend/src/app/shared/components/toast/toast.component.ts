import { Component, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { NotificationService } from '../../../core/services/notification.service';

@Component({
  selector: 'app-toast',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './toast.component.html',
  styleUrl: './toast.component.css'
})
export class ToastComponent {
  private notifService = inject(NotificationService);
  readonly notifications = computed(() => this.notifService.notifications());

  dismiss(id: number): void {
    this.notifService.dismiss(id);
  }

  trackById(_: number, item: { id: number }): number {
    return item.id;
  }
}
