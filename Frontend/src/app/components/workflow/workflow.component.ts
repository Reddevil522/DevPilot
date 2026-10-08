import { Component } from '@angular/core';

@Component({
  selector: 'dp-workflow',
  standalone: true,
  templateUrl: './workflow.component.html',
  styleUrl: './workflow.component.css'
})
export class WorkflowComponent {
  readonly steps = [
    { n: '01', title: 'Create', desc: 'Create your project and workspace.' },
    { n: '02', title: 'Code', desc: 'Write and edit code using the integrated editor.' },
    { n: '03', title: 'Ask AI', desc: 'Use AI to generate, explain, debug and improve code.' },
    { n: '04', title: 'Document', desc: 'Generate technical documentation automatically.' },
    { n: '05', title: 'Push', desc: 'Commit and push your changes.' },
    { n: '06', title: 'Deploy', desc: 'Deploy your project and monitor its status.' }
  ];
}
