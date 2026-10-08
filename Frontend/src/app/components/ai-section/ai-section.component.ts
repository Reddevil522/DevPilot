import { Component } from '@angular/core';

@Component({
  selector: 'dp-ai-section',
  standalone: true,
  templateUrl: './ai-section.component.html',
  styleUrl: './ai-section.component.css'
})
export class AiSectionComponent {
  readonly capabilities = [
    { icon: '⌘', title: 'Code Generation', desc: 'Describe what you need and get working code.' },
    { icon: '⚑', title: 'Debugging', desc: 'Find and fix errors without losing your flow.' },
    { icon: '☰', title: 'Code Explanation', desc: 'Understand unfamiliar code in plain language.' },
    { icon: '↻', title: 'Refactoring', desc: 'Clean up implementations without changing behavior.' },
    { icon: '▤', title: 'Documentation', desc: 'Keep technical docs accurate as your code evolves.' },
    { icon: '◈', title: 'Project Assistance', desc: 'Get help planning and organizing your work.' }
  ];
}
