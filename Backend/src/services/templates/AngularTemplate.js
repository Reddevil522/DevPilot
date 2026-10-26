const BaseTemplate = require('./BaseTemplate');
const path = require('path');

const NG = '^18.2.0';

class AngularTemplate extends BaseTemplate {
  async createStructure(targetDir = this.projectPath, isStandalone = true) {
    this.emitProgress(`Creating Angular structure in ${path.basename(targetDir) || 'root'}`);

    const srcDirs = [
      'src/app/core/guards',
      'src/app/core/interceptors',
      'src/app/core/services',
      'src/app/core/models',
      'src/app/shared/components',
      'src/app/shared/directives',
      'src/app/shared/pipes',
      'src/app/shared/models',
      'src/app/pages/home',
      'src/assets',
      'src/environments'
    ];
    await this.createDirectories(targetDir, srcDirs);

    // Keep otherwise-empty folders in git
    const keepDirs = [
      'src/app/core/models',
      'src/app/shared/components',
      'src/app/shared/directives',
      'src/app/shared/pipes',
      'src/app/shared/models',
      'src/assets'
    ];
    for (const d of keepDirs) {
      await this.createFile(targetDir, `${d}/.gitkeep`, '');
    }

    await this.generateConfigFiles(targetDir);
    await this.generateAppFiles(targetDir);
    await this.generateCoreFiles(targetDir);

    const readme = this.buildReadme(isStandalone ? this.projectName : 'Frontend');

    if (isStandalone) {
      await this.generateRootGitignore();
      await this.generateRootReadme(readme);
    } else {
      await this.createFile(targetDir, 'README.md', readme);
    }
  }

  buildReadme(heading) {
    return [
      `# ${heading}`,
      '',
      'Angular 18 single-page app using standalone components, lazy-loaded routes and functional interceptors/guards.',
      '',
      '## Requirements',
      '- Node.js 18.19 or newer (20+ recommended)',
      '',
      '## Getting started',
      '```bash',
      'npm install',
      'npm start',
      '```',
      'The app opens on `http://localhost:4200`.',
      '',
      '> DevPilot does not install dependencies automatically. Run `npm install` yourself.',
      '',
      '## Scripts',
      '| Command | What it does |',
      '| --- | --- |',
      '| `npm start` | Dev server (uses the development configuration) |',
      '| `npm run build` | Production build in `dist/frontend` |',
      '| `npm run watch` | Development build that rebuilds on change |',
      '| `npm test` | Unit tests with Karma + Jasmine |',
      '',
      '## Environments',
      '| File | Used when | `apiUrl` |',
      '| --- | --- | --- |',
      '| `src/environments/environment.development.ts` | `npm start`, `npm run watch` | `http://localhost:5000/api` |',
      '| `src/environments/environment.ts` | `npm run build` (production) | `/api` |',
      '',
      'Change `apiUrl` in these files to point at your backend.',
      '',
      '## Folder structure',
      '```',
      'src/app/',
      '  core/          loaded once for the whole app',
      '    guards/        route guards (auth.guard.ts)',
      '    interceptors/  HTTP interceptors (auth token, error handling)',
      '    services/      singleton services (auth.service.ts, api.service.ts)',
      '    models/        interfaces used across the app',
      '  shared/        reusable building blocks',
      '    components/ directives/ pipes/ models/',
      '  pages/         page-level components (home)',
      '  app.routes.ts  route table (pages are lazy-loaded)',
      '  app.config.ts  providers: router, HttpClient, interceptors',
      '```',
      '',
      '## How it fits together',
      '- `ApiService` wraps `HttpClient` and prefixes every call with `environment.apiUrl`.',
      '- `authInterceptor` adds `Authorization: Bearer <token>` when `AuthService` has a token.',
      '- `errorInterceptor` logs the user out when the API answers 401.',
      '- `authGuard` protects routes: `{ path: \'admin\', canActivate: [authGuard], ... }`.',
      '',
      '## Path aliases',
      '`@core/*`, `@shared/*` and `@env/*` are configured in `tsconfig.json`.',
      '',
      '## How to add a page',
      '1. Create `src/app/pages/about/about.component.ts` (standalone component).',
      '2. Add a lazy route in `src/app/app.routes.ts`:',
      '```ts',
      "{ path: 'about', loadComponent: () => import('./pages/about/about.component').then(m => m.AboutComponent) }",
      '```',
      ''
    ].join('\n');
  }

  async generateConfigFiles(dir) {
    await this.createFile(dir, 'package.json', JSON.stringify({
      name: `${this.projectName}-angular`,
      version: '0.0.0',
      private: true,
      scripts: {
        ng: 'ng',
        start: 'ng serve',
        build: 'ng build',
        watch: 'ng build --watch --configuration development',
        test: 'ng test'
      },
      dependencies: {
        '@angular/animations': NG,
        '@angular/common': NG,
        '@angular/compiler': NG,
        '@angular/core': NG,
        '@angular/forms': NG,
        '@angular/platform-browser': NG,
        '@angular/platform-browser-dynamic': NG,
        '@angular/router': NG,
        rxjs: '~7.8.0',
        tslib: '^2.3.0',
        'zone.js': '~0.14.10'
      },
      devDependencies: {
        '@angular-devkit/build-angular': '^18.2.21',
        '@angular/cli': '^18.2.21',
        '@angular/compiler-cli': NG,
        '@types/jasmine': '~5.1.0',
        'jasmine-core': '~5.2.0',
        karma: '~6.4.0',
        'karma-chrome-launcher': '~3.2.0',
        'karma-coverage': '~2.2.0',
        'karma-jasmine': '~5.1.0',
        'karma-jasmine-html-reporter': '~2.1.0',
        typescript: '~5.5.2'
      }
    }, null, 2));

    const envReplace = [{
      replace: 'src/environments/environment.ts',
      with: 'src/environments/environment.development.ts'
    }];

    await this.createFile(dir, 'angular.json', JSON.stringify({
      $schema: './node_modules/@angular/cli/lib/config/schema.json',
      version: 1,
      newProjectRoot: 'projects',
      projects: {
        frontend: {
          projectType: 'application',
          schematics: {},
          root: '',
          sourceRoot: 'src',
          prefix: 'app',
          architect: {
            build: {
              builder: '@angular-devkit/build-angular:application',
              options: {
                outputPath: 'dist/frontend',
                index: 'src/index.html',
                browser: 'src/main.ts',
                polyfills: ['zone.js'],
                tsConfig: 'tsconfig.app.json',
                assets: [{ glob: '**/*', input: 'src/assets', output: '/assets' }],
                styles: ['src/styles.css'],
                scripts: []
              },
              configurations: {
                production: {
                  budgets: [
                    { type: 'initial', maximumWarning: '500kB', maximumError: '1MB' },
                    { type: 'anyComponentStyle', maximumWarning: '4kB', maximumError: '8kB' }
                  ],
                  outputHashing: 'all'
                },
                development: {
                  optimization: false,
                  extractLicenses: false,
                  sourceMap: true,
                  fileReplacements: envReplace
                }
              },
              defaultConfiguration: 'production'
            },
            serve: {
              builder: '@angular-devkit/build-angular:dev-server',
              configurations: {
                production: { buildTarget: 'frontend:build:production' },
                development: { buildTarget: 'frontend:build:development' }
              },
              defaultConfiguration: 'development'
            },
            test: {
              builder: '@angular-devkit/build-angular:karma',
              options: {
                polyfills: ['zone.js', 'zone.js/testing'],
                tsConfig: 'tsconfig.spec.json',
                assets: [{ glob: '**/*', input: 'src/assets', output: '/assets' }],
                styles: ['src/styles.css'],
                scripts: []
              }
            }
          }
        }
      }
    }, null, 2));

    await this.createFile(dir, 'tsconfig.json', JSON.stringify({
      compileOnSave: false,
      compilerOptions: {
        outDir: './dist/out-tsc',
        strict: true,
        noImplicitOverride: true,
        noPropertyAccessFromIndexSignature: true,
        noImplicitReturns: true,
        noFallthroughCasesInSwitch: true,
        skipLibCheck: true,
        isolatedModules: true,
        esModuleInterop: true,
        experimentalDecorators: true,
        moduleResolution: 'bundler',
        importHelpers: true,
        target: 'ES2022',
        module: 'ES2022',
        lib: ['ES2022', 'dom'],
        baseUrl: './',
        paths: {
          '@core/*': ['src/app/core/*'],
          '@shared/*': ['src/app/shared/*'],
          '@env/*': ['src/environments/*']
        }
      },
      angularCompilerOptions: {
        enableI18nLegacyMessageIdFormat: false,
        strictInjectionParameters: true,
        strictInputAccessModifiers: true,
        strictTemplates: true
      }
    }, null, 2));

    await this.createFile(dir, 'tsconfig.app.json', JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: { outDir: './out-tsc/app', types: [] },
      files: ['src/main.ts'],
      include: ['src/**/*.d.ts']
    }, null, 2));

    await this.createFile(dir, 'tsconfig.spec.json', JSON.stringify({
      extends: './tsconfig.json',
      compilerOptions: { outDir: './out-tsc/spec', types: ['jasmine'] },
      include: ['src/**/*.spec.ts', 'src/**/*.d.ts']
    }, null, 2));

    await this.generateEditorConfig(dir);
  }

  async generateAppFiles(dir) {
    const name = this.projectName;

    await this.createFile(dir, 'src/index.html', `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>${name}</title>
  <base href="/">
  <meta name="viewport" content="width=device-width, initial-scale=1">
</head>
<body>
  <app-root></app-root>
</body>
</html>
`);

    await this.createFile(dir, 'src/main.ts', `import { bootstrapApplication } from '@angular/platform-browser';
import { AppComponent } from './app/app.component';
import { appConfig } from './app/app.config';

bootstrapApplication(AppComponent, appConfig).catch((err) => console.error(err));
`);

    await this.createFile(dir, 'src/styles.css', `/* Global Styles */
*, *::before, *::after { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; }
`);

    await this.createFile(dir, 'src/environments/environment.ts', `export const environment = {
  production: true,
  apiUrl: '/api'
};
`);
    await this.createFile(dir, 'src/environments/environment.development.ts', `export const environment = {
  production: false,
  apiUrl: 'http://localhost:5000/api'
};
`);

    await this.createFile(dir, 'src/app/app.component.ts', `import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet],
  templateUrl: './app.component.html',
  styleUrl: './app.component.css'
})
export class AppComponent {
  title = ${JSON.stringify(name)};
}
`);
    await this.createFile(dir, 'src/app/app.component.html', `<router-outlet></router-outlet>\n`);
    await this.createFile(dir, 'src/app/app.component.css', '');
    await this.createFile(dir, 'src/app/app.component.spec.ts', `import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { AppComponent } from './app.component';

describe('AppComponent', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [provideRouter([])]
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    expect(fixture.componentInstance).toBeTruthy();
  });
});
`);

    await this.createFile(dir, 'src/app/app.routes.ts', `import { Routes } from '@angular/router';

export const routes: Routes = [
  {
    path: '',
    pathMatch: 'full',
    loadComponent: () =>
      import('./pages/home/home.component').then((m) => m.HomeComponent)
  },
  { path: '**', redirectTo: '' }
];
`);

    await this.createFile(dir, 'src/app/app.config.ts', `import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { routes } from './app.routes';
import { authInterceptor } from './core/interceptors/auth.interceptor';
import { errorInterceptor } from './core/interceptors/error.interceptor';

export const appConfig: ApplicationConfig = {
  providers: [
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(routes, withComponentInputBinding()),
    provideHttpClient(withInterceptors([authInterceptor, errorInterceptor]))
  ]
};
`);

    await this.createFile(dir, 'src/app/pages/home/home.component.ts', `import { Component } from '@angular/core';

@Component({
  selector: 'app-home',
  standalone: true,
  template: \`
    <main class="home">
      <h1>Welcome to ${name}</h1>
      <p>Edit <code>src/app/pages/home/home.component.ts</code> to get started.</p>
    </main>
  \`,
  styles: [\`.home { max-width: 720px; margin: 4rem auto; padding: 0 1rem; }\`]
})
export class HomeComponent {}
`);
  }

  async generateCoreFiles(dir) {
    await this.createFile(dir, 'src/app/core/services/auth.service.ts', `import { Injectable, computed, signal } from '@angular/core';

const TOKEN_KEY = 'auth_token';

const storage = typeof localStorage !== 'undefined' ? localStorage : null;

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly _token = signal<string | null>(storage?.getItem(TOKEN_KEY) ?? null);

  readonly token = this._token.asReadonly();
  readonly isAuthenticated = computed(() => !!this._token());

  setToken(token: string): void {
    storage?.setItem(TOKEN_KEY, token);
    this._token.set(token);
  }

  logout(): void {
    storage?.removeItem(TOKEN_KEY);
    this._token.set(null);
  }
}
`);

    await this.createFile(dir, 'src/app/core/services/api.service.ts', `import { HttpClient, HttpParams } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable } from 'rxjs';
import { environment } from '../../../environments/environment';

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  private readonly baseUrl = environment.apiUrl;

  get<T>(path: string, params?: HttpParams): Observable<T> {
    return this.http.get<T>(\`\${this.baseUrl}\${path}\`, { params });
  }

  post<T>(path: string, body: unknown): Observable<T> {
    return this.http.post<T>(\`\${this.baseUrl}\${path}\`, body);
  }

  put<T>(path: string, body: unknown): Observable<T> {
    return this.http.put<T>(\`\${this.baseUrl}\${path}\`, body);
  }

  delete<T>(path: string): Observable<T> {
    return this.http.delete<T>(\`\${this.baseUrl}\${path}\`);
  }
}
`);

    await this.createFile(dir, 'src/app/core/guards/auth.guard.ts', `import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from '../services/auth.service';

export const authGuard: CanActivateFn = () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  return auth.isAuthenticated() ? true : router.createUrlTree(['/']);
};
`);

    await this.createFile(dir, 'src/app/core/interceptors/auth.interceptor.ts', `import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { AuthService } from '../services/auth.service';

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  return next(
    token ? req.clone({ setHeaders: { Authorization: \`Bearer \${token}\` } }) : req
  );
};
`);

    await this.createFile(dir, 'src/app/core/interceptors/error.interceptor.ts', `import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, throwError } from 'rxjs';
import { AuthService } from '../services/auth.service';

export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  return next(req).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status === 401) {
        auth.logout();
      }
      return throwError(() => err);
    })
  );
};
`);
  }
}

module.exports = AngularTemplate;
