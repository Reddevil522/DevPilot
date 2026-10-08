# DevPilot — Frontend

A premium, glassmorphic frontend for **DevPilot**, an AI-powered coding & project
management platform. Built with Angular 18 (standalone components), TypeScript, and
component-scoped CSS.

## Getting started

```bash
npm install
npm start        # ng serve — http://localhost:4200
npm run build     # production build to dist/devpilot
```

## What's included

- **Landing page** (`/`) — navbar, hero with a floating "workspace" visual, feature
  sections, an AI section, a 6-step workflow, a productivity panel, a CTA and a footer.
- **Login page** (`/login`) — validated reactive form, password visibility toggle,
  "remember me", loading/error/success states, Google button placeholder.
- **Register page** (`/register`) — full name / email / password / confirm password,
  password-strength meter, terms checkbox, matching validation states.
- **Light / dark theme system** — toggle in the navbar, persisted to
  `localStorage` under `devpilot-theme`, driven by CSS custom properties in
  `src/styles.css` and a `ThemeService`.
- **Reusable services** in `src/app/core/services`: `theme.service.ts`,
  `auth.service.ts` (stubbed — ready for real HTTP calls), `notification.service.ts`.
- **Shared components** in `src/app/components`: `logo`, `background`, `navbar`,
  `hero`, `trusted`, `features`, `showcase`, `ai-section`, `workflow`,
  `productivity`, `cta`, `footer`, `auth-side`.

## Notes

- Every component has its own scoped `.css` file with `devpilot-*` prefixed
  class names — no global/generic selectors, so styles can't leak between
  components.
- No backend/API logic is implemented. `AuthService` is a stub that resolves
  after a short delay so the UI states (loading, success, error) can be wired
  up once real endpoints exist.
- Routes for the future app (`/dashboard`, `/projects`, `/editor/:id`, etc.)
  are intentionally not implemented yet — only `/`, `/login` and `/register`.
- Google Fonts (Space Grotesk, Inter, JetBrains Mono) are loaded via
  `index.html`; production font-inlining is disabled in `angular.json` since
  it requires outbound access to fonts.googleapis.com at build time.
