import { Injectable, signal, effect } from '@angular/core';

export type DevPilotTheme = 'light' | 'dark';

const STORAGE_KEY = 'devpilot-theme';

@Injectable({ providedIn: 'root' })
export class ThemeService {
  readonly theme = signal<DevPilotTheme>(this.getInitialTheme());

  constructor() {
    effect(() => {
      const value = this.theme();
      document.documentElement.setAttribute('data-theme', value);
      try {
        localStorage.setItem(STORAGE_KEY, value);
      } catch {
        /* storage unavailable, ignore */
      }
    });
  }

  toggle(): void {
    this.theme.set(this.theme() === 'dark' ? 'light' : 'dark');
  }

  setTheme(value: DevPilotTheme): void {
    this.theme.set(value);
  }

  private getInitialTheme(): DevPilotTheme {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === 'light' || stored === 'dark') {
        return stored;
      }
    } catch {
      /* storage unavailable, ignore */
    }
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
    }
    return 'dark';
  }
}
