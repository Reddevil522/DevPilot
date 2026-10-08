import { Component } from '@angular/core';

interface FeatureItem {
  icon: string;
  title: string;
  description: string;
  points: string[];
}

@Component({
  selector: 'dp-features',
  standalone: true,
  templateUrl: './features.component.html',
  styleUrl: './features.component.css'
})
export class FeaturesComponent {
  readonly features: FeatureItem[] = [
    {
      icon: '✦',
      title: 'AI Coding Assistant',
      description: 'Let AI handle the repetitive parts of writing software.',
      points: ['Generate code', 'Explain code', 'Refactor code', 'Debug errors', 'Improve implementations']
    },
    {
      icon: '▦',
      title: 'Project Management',
      description: 'Organize every project and workspace in one place.',
      points: ['Create projects', 'Organize projects', 'Manage workspaces', 'Track development progress']
    },
    {
      icon: '</>',
      title: 'Integrated Code Editor',
      description: 'A modern editor with everything you need, built in.',
      points: ['File explorer', 'Syntax highlighting', 'Multiple tabs', 'Built-in terminal']
    },
    {
      icon: '▤',
      title: 'AI Documentation',
      description: 'DevPilot generates and maintains technical documentation using AI.',
      points: ['Auto-generated docs', 'Stays up to date', 'Readable by your whole team']
    },
    {
      icon: '⌥',
      title: 'Git & Code Push',
      description: 'Track changes and ship them without leaving DevPilot.',
      points: ['Changes', 'Commit', 'Push', 'Repository status']
    },
    {
      icon: '⇪',
      title: 'Deployment',
      description: 'Go from a finished build to a live application in one step.',
      points: ['Build', 'Deploy', 'Live']
    }
  ];
}
