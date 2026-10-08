import { Component, signal, inject, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { SharedIconsModule } from '../../shared/shared-icons.module';
import { WorkspaceService } from '../../core/services/workspace.service';

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
  private workspaceService = inject(WorkspaceService);
  readonly activeProject = this.workspaceService.activeProject;

  readonly activeTab = signal<PanelTab>('terminal');
  readonly tabs: PanelTab[] = ['terminal', 'problems', 'output', 'debug'];

  readonly terminalLines = computed<TerminalLine[]>(() => {
    const proj = this.activeProject();
    const promptPath = proj?.localPath || (proj?.name ? `~/${proj.name}` : '~/workspace');
    return [
      { type: 'output', text: `DevPilot Terminal — Working Directory: ${promptPath}` },
      { type: 'success', text: `✓ Local workspace mounted at ${promptPath}` },
      { type: 'output', text: `Project: ${proj?.name || 'Local'} [${proj?.technology || 'JavaScript'}]` },
      { type: 'blank', text: '' },
      { type: 'command', text: `devpilot@workspace ${promptPath} $ ` }
    ];
  });

  selectTab(tab: PanelTab): void {
    this.activeTab.set(tab);
  }

  getTabLabel(tab: PanelTab): string {
    return tab.charAt(0).toUpperCase() + tab.slice(1).replace('-', ' ');
  }
}
