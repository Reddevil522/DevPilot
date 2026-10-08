import { Component } from '@angular/core';

@Component({
  selector: 'dp-productivity',
  standalone: true,
  templateUrl: './productivity.component.html',
  styleUrl: './productivity.component.css'
})
export class ProductivityComponent {
  readonly benefits = [
    'Faster development',
    'AI assistance',
    'Centralized project management',
    'Integrated code editor',
    'Automated documentation',
    'Easy deployment',
    'Developer-focused workflow'
  ];
}
