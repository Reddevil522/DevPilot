import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedIconsModule } from '../../shared/shared-icons.module';

type PanelTab = 'terminal' | 'problems' | 'output' | 'debug';

interface TerminalLine {
  type: 'command' | 'output' | 'success' | 'error' | 'blank';
  text: string;
}

@Component({
  selector: 'app-bottom-panel',
  standalone: true,
  imports: [CommonModule, SharedIconsModule],
  templateUrl: './bottom-panel.component.html',
  styleUrl: './bottom-panel.component.css'
})
export class BottomPanelComponent {
  readonly activeTab = signal<PanelTab>('terminal');
  readonly tabs: PanelTab[] = ['terminal', 'problems', 'output', 'debug'];

  readonly terminalLines = signal<TerminalLine[]>([
    { type: 'command', text: 'devpilot@workspace ~/e-commerce-api $ npm install' },
    { type: 'output', text: 'npm warn deprecated inflight@1.0.6' },
    { type: 'output', text: 'added 847 packages in 12.3s' },
    { type: 'blank', text: '' },
    { type: 'command', text: 'devpilot@workspace ~/e-commerce-api $ npm run dev' },
    { type: 'output', text: '' },
    { type: 'output', text: '> e-commerce-api@1.0.0 dev' },
    { type: 'output', text: '> ts-node-dev --respawn src/server.ts' },
    { type: 'blank', text: '' },
    { type: 'success', text: '✓ Connecting to MongoDB...' },
    { type: 'success', text: '✓ Connected to database' },
    { type: 'success', text: '✓ Server running on port 5000' },
    { type: 'command', text: 'devpilot@workspace ~/e-commerce-api $ ' }
  ]);

  selectTab(tab: PanelTab): void {
    this.activeTab.set(tab);
  }

  getTabLabel(tab: PanelTab): string {
    return tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ');
  }
}
