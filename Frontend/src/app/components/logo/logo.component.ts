import { Component, Input } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'dp-logo',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './logo.component.html',
  styleUrl: './logo.component.css'
})
export class LogoComponent {
  /** icon size in px — logo scales cleanly at 16 / 24 / 32 / 48 / 64 */
  @Input() size = 28;
  @Input() showWordmark = true;
}
