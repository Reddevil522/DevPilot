const BaseTemplate = require('./BaseTemplate');
const path = require('path');

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

    await this.createFile(targetDir, 'src/environments/environment.ts', 'export const environment = {};\n');
    await this.createFile(targetDir, 'src/environments/environment.development.ts', 'export const environment = {};\n');

    await this.generateAngularFiles(targetDir);
    
    if (isStandalone) {
      await this.generateRootGitignore();
      await this.generateRootReadme(`# ${this.projectName}\n\nAngular SPA architecture.\n\nFolders:\n- \`src/app/core\`: Services, models, guards\n- \`src/app/shared\`: Reusable UI components\n- \`src/app/pages\`: Page-level components\n`);
    } else {
      await this.createFile(targetDir, 'README.md', `# Frontend\n\nAngular SPA architecture.\n\nFolders:\n- \`src/app/core\`: Services, models, guards\n- \`src/app/shared\`: Reusable UI components\n- \`src/app/pages\`: Page-level components\n`);
    }
  }

  async generateAngularFiles(dir) {
    await this.createFile(dir, 'package.json', JSON.stringify({
      name: `${this.projectName}-angular`,
      version: "0.0.0",
      scripts: {
        ng: "ng",
        start: "ng serve",
        build: "ng build",
        watch: "ng build --watch --configuration development",
        test: "ng test"
      },
      private: true,
      dependencies: {
        "@angular/animations": "^18.2.0",
        "@angular/common": "^18.2.0",
        "@angular/compiler": "^18.2.0",
        "@angular/core": "^18.2.0",
        "@angular/forms": "^18.2.0",
        "@angular/platform-browser": "^18.2.0",
        "@angular/platform-browser-dynamic": "^18.2.0",
        "@angular/router": "^18.2.0",
        "rxjs": "~7.8.0",
        "tslib": "^2.3.0",
        "zone.js": "~0.14.10"
      },
      devDependencies: {
        "@angular-devkit/build-angular": "^18.2.21",
        "@angular/cli": "^18.2.21",
        "@angular/compiler-cli": "^18.2.0",
        "typescript": "~5.5.2"
      }
    }, null, 2));

    await this.createFile(dir, 'angular.json', JSON.stringify({
      "$schema": "./node_modules/@angular/cli/lib/config/schema.json",
      "version": 1,
      "newProjectRoot": "projects",
      "projects": {
        "frontend": {
          "projectType": "application",
          "schematics": {},
          "root": "",
          "sourceRoot": "src",
          "prefix": "app",
          "architect": {
            "build": {
              "builder": "@angular-devkit/build-angular:browser",
              "options": {
                "outputPath": "dist/frontend",
                "index": "src/index.html",
                "main": "src/main.ts",
                "polyfills": ["zone.js"],
                "tsConfig": "tsconfig.app.json",
                "assets": ["src/assets"],
                "styles": ["src/styles.css"],
                "scripts": []
              }
            },
            "serve": {
              "builder": "@angular-devkit/build-angular:dev-server",
              "options": {
                "buildTarget": "frontend:build"
              }
            }
          }
        }
      }
    }, null, 2));

    await this.createFile(dir, 'tsconfig.json', JSON.stringify({
      "compileOnSave": false,
      "compilerOptions": {
        "outDir": "./dist/out-tsc",
        "strict": true,
        "noImplicitOverride": true,
        "noPropertyAccessFromIndexSignature": true,
        "noImplicitReturns": true,
        "noFallthroughCasesInSwitch": true,
        "skipLibCheck": true,
        "isolatedModules": true,
        "esModuleInterop": true,
        "experimentalDecorators": true,
        "moduleResolution": "node",
        "importHelpers": true,
        "target": "ES2022",
        "module": "ES2022"
      }
    }, null, 2));

    await this.createFile(dir, 'tsconfig.app.json', JSON.stringify({
      "extends": "./tsconfig.json",
      "compilerOptions": {
        "outDir": "./out-tsc/app",
        "types": []
      },
      "files": [
        "src/main.ts"
      ],
      "include": [
        "src/**/*.d.ts"
      ]
    }, null, 2));

    await this.createFile(dir, 'src/index.html', `<!doctype html>\n<html lang="en">\n<head>\n  <meta charset="utf-8">\n  <title>${this.projectName}</title>\n  <base href="/">\n  <meta name="viewport" content="width=device-width, initial-scale=1">\n</head>\n<body>\n  <app-root></app-root>\n</body>\n</html>`);
    await this.createFile(dir, 'src/main.ts', `import { bootstrapApplication } from '@angular/platform-browser';\nimport { AppComponent } from './app/app.component';\nimport { appConfig } from './app/app.config';\n\nbootstrapApplication(AppComponent, appConfig)\n  .catch((err) => console.error(err));\n`);
    await this.createFile(dir, 'src/styles.css', `/* Global Styles */\nbody { font-family: sans-serif; margin: 0; padding: 0; }`);
    
    await this.createFile(dir, 'src/app/app.component.ts', `import { Component } from '@angular/core';\nimport { RouterOutlet } from '@angular/router';\n\n@Component({\n  selector: 'app-root',\n  standalone: true,\n  imports: [RouterOutlet],\n  templateUrl: './app.component.html',\n  styleUrl: './app.component.css'\n})\nexport class AppComponent {\n  title = '${this.projectName}';\n}\n`);
    await this.createFile(dir, 'src/app/app.component.html', `<h1>Welcome to {{title}}</h1>\n<router-outlet></router-outlet>`);
    await this.createFile(dir, 'src/app/app.component.css', ``);
    await this.createFile(dir, 'src/app/app.routes.ts', `import { Routes } from '@angular/router';\n\nexport const routes: Routes = [];\n`);
    await this.createFile(dir, 'src/app/app.config.ts', `import { ApplicationConfig, provideZoneChangeDetection } from '@angular/core';\nimport { provideRouter } from '@angular/router';\nimport { routes } from './app.routes';\n\nexport const appConfig: ApplicationConfig = {\n  providers: [\n    provideZoneChangeDetection({ eventCoalescing: true }),\n    provideRouter(routes)\n  ]\n};\n`);
  }
}

module.exports = AngularTemplate;
