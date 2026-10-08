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

    if (isStandalone) {
      await this.generateRootGitignore();
      await this.generateRootReadme(`# ${this.projectName}\n\nReact application.\n\nFolders:\n- \`src/components\`: Reusable UI components\n- \`src/pages\`: Page-level components\n- \`src/hooks\`: Custom React hooks\n- \`src/services\`: API and service integration\n- \`src/context\`: Global state context\n`);
    } else {
      await this.createFile(targetDir, 'README.md', `# Frontend\n\nReact application.\n\nFolders:\n- \`src/components\`: Reusable UI components\n- \`src/pages\`: Page-level components\n- \`src/hooks\`: Custom React hooks\n- \`src/services\`: API and service integration\n- \`src/context\`: Global state context\n`);
    }
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
        "react-dom": "^18.2.0"
      },
      devDependencies: {
        "@vitejs/plugin-react": "^4.2.1",
        "vite": "^5.1.0"
      }
    }, null, 2));

    await this.createFile(dir, 'vite.config.js', `import { defineConfig } from 'vite'\nimport react from '@vitejs/plugin-react'\n\nexport default defineConfig({\n  plugins: [react()],\n})\n`);

    await this.createFile(dir, 'index.html', `<!DOCTYPE html>\n<html lang="en">\n  <head>\n    <meta charset="utf-8" />\n    <title>${this.projectName}</title>\n  </head>\n  <body>\n    <div id="root"></div>\n    <script type="module" src="/src/main.jsx"></script>\n  </body>\n</html>`);
    await this.createFile(dir, 'src/main.jsx', `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App.jsx';\nimport './index.css';\n\nReactDOM.createRoot(document.getElementById('root')).render(\n  <React.StrictMode>\n    <App />\n  </React.StrictMode>\n);\n`);
    await this.createFile(dir, 'src/App.jsx', `import React from 'react';\n\nfunction App() {\n  return (\n    <div>\n      <h1>Welcome to ${this.projectName}</h1>\n    </div>\n  );\n}\n\nexport default App;\n`);
    await this.createFile(dir, 'src/index.css', `/* Global Styles */\nbody { font-family: sans-serif; margin: 0; padding: 0; }`);
  }
}

module.exports = ReactTemplate;
