import { Routes } from '@angular/router';
import { authGuard } from './core/guards/auth.guard';

export const routes: Routes = [
  /* ── Public Routes ─────────────────────────────────────────── */
  {
    path: '',
    loadComponent: () =>
      import('./pages/landing/landing.component').then((m) => m.LandingComponent),
    title: 'DevPilot — Build. Code. Deploy. With AI.'
  },
  {
    path: 'login',
    loadComponent: () =>
      import('./pages/login/login.component').then((m) => m.LoginComponent),
    title: 'Sign In — DevPilot'
  },
  {
    path: 'register',
    loadComponent: () =>
      import('./pages/register/register.component').then((m) => m.RegisterComponent),
    title: 'Create Account — DevPilot'
  },

  /* ── Protected App Routes (wrapped in workspace layout) ─────── */
  {
    path: '',
    loadComponent: () =>
      import('./workspace/workspace-layout/workspace-layout.component').then(
        (m) => m.WorkspaceLayoutComponent
      ),
    canActivate: [authGuard],
    children: [
      {
        path: 'dashboard',
        loadComponent: () =>
          import('./pages/dashboard/dashboard.component').then((m) => m.DashboardComponent),
        title: 'Dashboard — DevPilot'
      },
      {
        path: 'projects/:id',
        loadComponent: () =>
          import('./pages/project/project.component').then((m) => m.ProjectComponent),
        title: 'Workspace — DevPilot'
      },
      {
        path: 'projects/:id/settings',
        loadComponent: () =>
          import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
        title: 'Project Settings — DevPilot'
      },
      {
        path: 'documentation',
        loadComponent: () =>
          import('./pages/documentation/documentation.component').then(
            (m) => m.DocumentationComponent
          ),
        title: 'Documentation — DevPilot'
      },
      {
        path: 'deployments',
        loadComponent: () =>
          import('./pages/deployments/deployments.component').then(
            (m) => m.DeploymentsComponent
          ),
        title: 'Deployments — DevPilot'
      }
    ]
  },

  /* ── Fallback ───────────────────────────────────────────────── */
  { path: '**', redirectTo: '' }
];
