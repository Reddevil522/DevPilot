import { Component, Input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { LogoComponent } from '../logo/logo.component';

@Component({
  selector: 'dp-auth-side',
  standalone: true,
  imports: [RouterLink, LogoComponent],
  templateUrl: './auth-side.component.html',
  styleUrl: './auth-side.component.css'
})
export class AuthSideComponent {
  @Input() headline = 'Build. Code. Deploy. With AI.';
  @Input() message =
    'DevPilot brings your projects, editor, AI assistant and deployments into one focused workspace.';
}
