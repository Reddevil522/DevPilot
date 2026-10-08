import { Component } from '@angular/core';

@Component({
  selector: 'dp-trusted',
  standalone: true,
  templateUrl: './trusted.component.html',
  styleUrl: './trusted.component.css'
})
export class TrustedComponent {
  readonly indicators = [
    'AI Powered',
    'Project Management',
    'Code Editor',
    'Git Integration',
    'Documentation',
    'Deployment'
  ];
}
