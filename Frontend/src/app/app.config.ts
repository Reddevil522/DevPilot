import { ApplicationConfig, provideZoneChangeDetection, APP_INITIALIZER } from '@angular/core';
import {
  provideRouter,
  withInMemoryScrolling,
  withRouterConfig
} from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { provideAnimations } from '@angular/platform-browser/animations';
import { provideMonacoEditor } from 'ngx-monaco-editor-v2';
import { AuthService } from './core/services/auth.service';

import { routes } from './app.routes';
import { authInterceptorFn } from './core/interceptors/auth.interceptor';

export function initializeAuth(authService: AuthService) {
  return () => authService.init();
}

export const appConfig: ApplicationConfig = {
  providers: [
    {
      provide: APP_INITIALIZER,
      useFactory: initializeAuth,
      deps: [AuthService],
      multi: true
    },
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideRouter(
      routes,
      withInMemoryScrolling({ anchorScrolling: 'enabled', scrollPositionRestoration: 'enabled' }),
      withRouterConfig({ paramsInheritanceStrategy: 'always' })
    ),
    provideHttpClient(withInterceptors([authInterceptorFn])),
    provideAnimations(),
    provideMonacoEditor({
      defaultOptions: { scrollBeyondLastLine: false, automaticLayout: true }
    })
  ]
};
