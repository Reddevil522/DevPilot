import { Component } from '@angular/core';
import { RouterLink } from '@angular/router';

@Component({
  selector: 'dp-cta',
  standalone: true,
  imports: [RouterLink],
  templateUrl: './cta.component.html',
  styleUrl: './cta.component.css'
})
export class CtaComponent {}
