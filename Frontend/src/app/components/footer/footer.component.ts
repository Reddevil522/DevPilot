import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LogoComponent } from '../logo/logo.component';

interface FooterColumn {
  title: string;
  links: string[];
}

@Component({
  selector: 'dp-footer',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  templateUrl: './footer.component.html',
  styleUrl: './footer.component.css'
})
export class FooterComponent {
  readonly year = new Date().getFullYear();

  readonly columns: FooterColumn[] = [
    { title: 'Product', links: ['Features', 'AI Assistant', 'Code Editor', 'Documentation', 'Deployment'] },
    { title: 'Resources', links: ['Documentation', 'API', 'Guides', 'Help Center'] },
    { title: 'Company', links: ['About', 'Contact', 'GitHub'] }
  ];
}
