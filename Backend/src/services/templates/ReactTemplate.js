const BaseTemplate = require('./BaseTemplate');
const path = require('path');

class ReactTemplate extends BaseTemplate {
  async createStructure(targetDir = this.projectPath, isStandalone = true) {
    this.emitProgress(`Creating React structure in ${path.basename(targetDir) || 'root'}`);

    const srcDirs = [
      'src/assets',
      'src/components',
      'src/pages',
      'src/layouts',
      'src/hooks',
      'src/services',
      'src/utils',
      'src/types',
      'src/context',
      'src/routes'
    ];
    await this.createDirectories(targetDir, srcDirs);

    await this.generateReactFiles(targetDir);

    // Keep empty folders in git
    await this.createGitkeeps(targetDir, [
      'src/assets',
      'src/components',
      'src/hooks',
      'src/utils',
      'src/types',
      'src/context'
    ]);
    await this.generateEditorConfig(targetDir);

    if (isStandalone) {
      await this.generateRootGitignore();
      await this.generateRootReadme(this.buildReadme(this.projectName));
    } else {
      await this.createFile(targetDir, 'README.md', this.buildReadme('Frontend'));
    }
  }

  buildReadme(heading) {
    return [
      `# ${heading}`,
      '',
      'React 18 single-page app built with Vite, with React Router, a layout, and a small API client ready to use.',
      '',
      '## Requirements',
      '- Node.js 18 or newer',
      '',
      '## Getting started',
      '```bash',
      'npm install',
      'cp .env.example .env     # optional: only needed to change the API URL',
      'npm run dev',
      '```',
      'The app opens on `http://localhost:5173`.',
      '',
      '> DevPilot does not install dependencies automatically. Run `npm install` yourself.',
      '',
      '## Scripts',
      '| Command | What it does |',
      '| --- | --- |',
      '| `npm run dev` | Start the Vite dev server with hot reload |',
      '| `npm run build` | Create a production build in `dist/` |',
      '| `npm run preview` | Serve the production build locally |',
      '',
      '## Environment variables',
      'Vite only exposes variables that start with `VITE_`.',
      '',
      '| Variable | Default | Purpose |',
      '| --- | --- | --- |',
      '| `VITE_API_URL` | `http://localhost:5000/api` | Base URL used by `src/services/api.js` |',
      '',
      '## Folder structure',
      '```',
      'src/',
      '  assets/      images, fonts, static files',
      '  components/  reusable UI pieces (buttons, cards, modals)',
      '  pages/       one component per screen (Home, NotFound)',
      '  layouts/     page wrappers shared by many pages (MainLayout)',
      '  routes/      route table (AppRoutes.jsx)',
      '  hooks/       custom React hooks',
      '  services/    API calls (api.js is the base client)',
      '  context/     global state via React Context',
      '  utils/       plain helper functions',
      '  types/       shared type / shape definitions',
      '  main.jsx     entry point, mounts the app inside BrowserRouter',
      '  App.jsx      renders the routes',
      '```',
      '',
      '## How to add a page',
      '1. Create `src/pages/About.jsx`.',
      '2. Add `<Route path="/about" element={<About />} />` in `src/routes/AppRoutes.jsx`.',
      '',
      '## Calling the backend',
      '```js',
      "import { api } from '@/services/api';",
      '',
      "const data = await api.get('/health');",
      '```',
      'The `@` alias points to `src/`.',
      ''
    ].join('\n');
  }

  async generateReactFiles(dir) {
    await this.createFile(dir, 'package.json', JSON.stringify({
      name: `${this.projectName}-react`,
      version: "1.0.0",
      private: true,
      scripts: {
        "dev": "vite",
        "build": "vite build",
        "preview": "vite preview"
      },
      dependencies: {
        "react": "^18.2.0",
        "react-dom": "^18.2.0",
        "react-router-dom": "^6.26.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.2.1",
        "vite": "^5.1.0"
      }
    }, null, 2));

    await this.createFile(dir, 'vite.config.js', [
      "import { defineConfig } from 'vite'",
      "import react from '@vitejs/plugin-react'",
      "import { fileURLToPath, URL } from 'node:url'",
      '',
      'export default defineConfig({',
      '  plugins: [react()],',
      '  resolve: {',
      '    alias: {',
      "      '@': fileURLToPath(new URL('./src', import.meta.url)),",
      '    },',
      '  },',
      '})',
      ''
    ].join('\n'));

    await this.createFile(dir, 'jsconfig.json', JSON.stringify({
      compilerOptions: {
        baseUrl: '.',
        paths: { '@/*': ['src/*'] },
        jsx: 'react-jsx'
      },
      include: ['src']
    }, null, 2) + '\n');

    await this.createFile(dir, '.env.example', 'VITE_API_URL=http://localhost:5000/api\n');

    await this.createFile(dir, 'index.html', `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${this.projectName}</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`);

    await this.createFile(dir, 'src/main.jsx', `import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App.jsx';
import './index.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </React.StrictMode>
);
`);

    await this.createFile(dir, 'src/App.jsx', `import AppRoutes from './routes/AppRoutes.jsx';

function App() {
  return <AppRoutes />;
}

export default App;
`);

    await this.createFile(dir, 'src/index.css', `/* Global Styles */
*, *::before, *::after { box-sizing: border-box; }
body { font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; margin: 0; padding: 0; }
.layout__content { max-width: 960px; margin: 0 auto; padding: 2rem 1rem; }
`);

    await this.createFile(dir, 'src/routes/AppRoutes.jsx', `import { Routes, Route } from 'react-router-dom';
import MainLayout from '../layouts/MainLayout.jsx';
import Home from '../pages/Home.jsx';
import NotFound from '../pages/NotFound.jsx';

function AppRoutes() {
  return (
    <Routes>
      <Route element={<MainLayout />}>
        <Route path="/" element={<Home />} />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}

export default AppRoutes;
`);

    await this.createFile(dir, 'src/layouts/MainLayout.jsx', `import { Outlet } from 'react-router-dom';

function MainLayout() {
  return (
    <div className="layout">
      <main className="layout__content">
        <Outlet />
      </main>
    </div>
  );
}

export default MainLayout;
`);

    await this.createFile(dir, 'src/pages/Home.jsx', `function Home() {
  return (
    <div>
      <h1>Welcome to ${this.projectName}</h1>
      <p>Edit src/pages/Home.jsx to get started.</p>
    </div>
  );
}

export default Home;
`);

    await this.createFile(dir, 'src/pages/NotFound.jsx', `import { Link } from 'react-router-dom';

function NotFound() {
  return (
    <div>
      <h1>404 - Page not found</h1>
      <Link to="/">Back to home</Link>
    </div>
  );
}

export default NotFound;
`);

    await this.createFile(dir, 'src/services/api.js', `// Base API client. Set VITE_API_URL in .env to point at your backend.
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

async function request(path, options = {}) {
  const { headers, ...rest } = options;
  const response = await fetch(API_URL + path, {
    headers: { 'Content-Type': 'application/json', ...headers },
    ...rest,
  });

  if (!response.ok) {
    throw new Error('Request failed with status ' + response.status);
  }
  return response.status === 204 ? null : response.json();
}

export const api = {
  get: (path) => request(path),
  post: (path, body) => request(path, { method: 'POST', body: JSON.stringify(body) }),
  put: (path, body) => request(path, { method: 'PUT', body: JSON.stringify(body) }),
  delete: (path) => request(path, { method: 'DELETE' }),
};
`);
  }
}

module.exports = ReactTemplate;
