import { Component } from '@angular/core';
import { BackgroundComponent } from '../../components/background/background.component';
import { NavbarComponent } from '../../components/navbar/navbar.component';
import { HeroComponent } from '../../components/hero/hero.component';
import { TrustedComponent } from '../../components/trusted/trusted.component';
import { FeaturesComponent } from '../../components/features/features.component';
import { ShowcaseComponent } from '../../components/showcase/showcase.component';
import { AiSectionComponent } from '../../components/ai-section/ai-section.component';
import { WorkflowComponent } from '../../components/workflow/workflow.component';
import { ProductivityComponent } from '../../components/productivity/productivity.component';
import { CtaComponent } from '../../components/cta/cta.component';
import { FooterComponent } from '../../components/footer/footer.component';

@Component({
  selector: 'app-landing',
  standalone: true,
  imports: [
    BackgroundComponent,
    NavbarComponent,
    HeroComponent,
    TrustedComponent,
    FeaturesComponent,
    ShowcaseComponent,
    AiSectionComponent,
    WorkflowComponent,
    ProductivityComponent,
    CtaComponent,
    FooterComponent
  ],
  templateUrl: './landing.component.html',
  styleUrl: './landing.component.css'
})
export class LandingComponent {}
