import { Component, signal } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { ThemeService } from '../../core/services/theme.service';
import { LogoComponent } from '../logo/logo.component';

interface NavLink {
  label: string;
  fragment: string;
}

@Component({
  selector: 'dp-navbar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, LogoComponent],
  templateUrl: './navbar.component.html',
  styleUrl: './navbar.component.css'
})
export class NavbarComponent {
  readonly isMenuOpen = signal(false);

  readonly links: NavLink[] = [
    { label: 'Home', fragment: 'top' },
    { label: 'Features', fragment: 'features' },
    { label: 'AI', fragment: 'ai' },
    { label: 'Documentation', fragment: 'workflow' },
    { label: 'Deployment', fragment: 'cta' }
  ];

  constructor(public theme: ThemeService) {}

  toggleMenu(): void {
    this.isMenuOpen.update((v) => !v);
  }

  closeMenu(): void {
    this.isMenuOpen.set(false);
  }
}
