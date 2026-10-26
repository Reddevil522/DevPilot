const BaseTemplate = require('./BaseTemplate');
const ReactTemplate = require('./ReactTemplate');
const AngularTemplate = require('./AngularTemplate');
const path = require('path');
const fs = require('fs').promises;

class AiApplicationTemplate extends BaseTemplate {
  async createStructure() {
    this.emitProgress('Creating AI Application structure');

    // Create frontend and backend directories
    const fePath = path.join(this.projectPath, 'frontend');
    const bePath = path.join(this.projectPath, 'backend');
    await fs.mkdir(fePath, { recursive: true });
    await fs.mkdir(bePath, { recursive: true });

    // 1. Frontend
    if (this.technology && this.technology.toLowerCase() === 'react') {
      const reactTemplate = new ReactTemplate(this.projectPath, this.projectName, this.description, this.projectId, this.technology, this.projectType, this.emitProgress);
      await reactTemplate.createStructure(fePath, false);
    } else {
      const angularTemplate = new AngularTemplate(this.projectPath, this.projectName, this.description, this.projectId, this.technology, this.projectType, this.emitProgress);
      await angularTemplate.createStructure(fePath, false);
    }

    // 2. AI Backend
    const beDirs = [
      'src/config',
      'src/controllers',
      'src/models',
      'src/routes',
      'src/middleware',
      'src/services/ai',
      'src/services/embeddings',
      'src/services/prompts',
      'src/validators',
      'src/utils'
    ];
    await this.createDirectories(bePath, beDirs);

    // AI Backend files (simulated Express setup)
    await this.createFile(bePath, 'package.json', JSON.stringify({
      name: `${this.projectName}-ai-backend`,
      version: "1.0.0",
      main: "src/server.js",
      scripts: {
        "start": "node src/server.js",
        "dev": "nodemon src/server.js"
      },
      dependencies: {
        "cors": "^2.8.6",
        "dotenv": "^18.0.1",
        "express": "^5.2.1",
        "helmet": "^8.3.0"
      },
      devDependencies: {
        "nodemon": "^3.1.14"
      }
    }, null, 2));

    await this.createFile(bePath, '.env.example', `PORT=5000\nOPENAI_API_KEY=\nANTHROPIC_API_KEY=\n`);
    await this.createFile(bePath, 'src/server.js', `require('dotenv').config();\nconst express = require('express');\nconst app = express();\n\napp.use(express.json());\n\napp.get('/api/health', (req, res) => {\n  res.json({ status: 'ok', type: 'AI API' });\n});\n\nconst PORT = process.env.PORT || 5000;\napp.listen(PORT, () => console.log(\`AI Backend running on port \${PORT}\`));\n`);

    // Keep empty folders in git + editor settings + backend docs
    await this.createGitkeeps(bePath, beDirs);
    await this.generateEditorConfig(bePath);
    await this.createFile(bePath, 'README.md', this.buildBackendReadme());

    // 3. Root Files
    await this.generateRootGitignore();
    await this.generateRootReadme(this.buildReadme());
  }

  buildReadme() {
    const isReact = this.technology && this.technology.toLowerCase() === 'react';
    const fe = isReact ? 'React (Vite)' : 'Angular';
    const fePort = isReact ? '5173' : '4200';
    const feCmd = isReact ? 'npm run dev' : 'npm start';
    return [
      `# ${this.projectName}`,
      '',
      'AI application starter: a web frontend plus a Node.js backend that is organised for AI work (model calls, embeddings, prompts).',
      '',
      '## Structure',
      '```',
      '.',
      `  frontend/   ${fe} app (UI)`,
      '  backend/    Node.js + Express API with AI-focused service folders',
      '  .devpilot/  local project identity (git-ignored)',
      '```',
      'Each folder has its own README. Read those next.',
      '',
      '## Requirements',
      '- Node.js 20 or newer',
      '- An API key for the AI provider you want to use (OpenAI and/or Anthropic)',
      '',
      '## Getting started',
      '> DevPilot does not install dependencies automatically. Run `npm install` in each folder yourself.',
      '',
      'Terminal 1 - backend (http://localhost:5000):',
      '```bash',
      'cd backend',
      'cp .env.example .env     # then add your API keys',
      'npm install',
      'npm run dev',
      '```',
      '',
      `Terminal 2 - frontend (http://localhost:${fePort}):`,
      '```bash',
      'cd frontend',
      'npm install',
      feCmd,
      '```',
      '',
      '## Keep your keys safe',
      '- API keys live only in `backend/.env`, which is git-ignored.',
      '- Call the AI provider from the backend, never from the browser, so the key is never exposed.',
      '',
      '## Git',
      'A `.gitignore` is included. It keeps `node_modules`, build output, `.env` files and logs out of git. `.env.example` files are committed.',
      ''
    ].join('\n');
  }

  buildBackendReadme() {
    return [
      '# Backend (AI API)',
      '',
      'Node.js + Express starter API. The folders are prepared for typical AI features.',
      '',
      '## Getting started',
      '```bash',
      'cp .env.example .env     # add OPENAI_API_KEY and/or ANTHROPIC_API_KEY',
      'npm install',
      'npm run dev',
      '```',
      'Health check: `GET http://localhost:5000/api/health` returns `{ status: \'ok\', type: \'AI API\' }`.',
      '',
      '## Scripts',
      '| Command | What it does |',
      '| --- | --- |',
      '| `npm run dev` | Start with nodemon (auto-restart) |',
      '| `npm start` | Start with node |',
      '',
      '## Environment variables (`.env`)',
      '| Variable | Purpose |',
      '| --- | --- |',
      '| `PORT` | Port to listen on (default 5000) |',
      '| `OPENAI_API_KEY` | OpenAI key, if you use OpenAI |',
      '| `ANTHROPIC_API_KEY` | Anthropic key, if you use Claude |',
      '',
      '## Folder structure',
      '```',
      'src/',
      '  services/',
      '    ai/           code that calls the AI provider (chat, completions)',
      '    embeddings/   create and search vector embeddings',
      '    prompts/      prompt templates, kept apart from code',
      '  controllers/    handle req/res, call services',
      '  routes/         URL -> controller mapping',
      '  middleware/     auth, rate limiting, error handling',
      '  validators/     request validation',
      '  models/         database models (add a database when you need one)',
      '  config/         configuration helpers',
      '  utils/          small helpers',
      '  server.js       starter entry point (loads .env, exposes /api/health)',
      '```',
      '',
      '## Good to know',
      '- `server.js` is a minimal starter. `cors` and `helmet` are installed but not enabled yet. Add `app.use(cors())` and `app.use(helmet())` before calling the API from a browser.',
      '- Every folder above is empty on purpose (`.gitkeep`). Add your code as you build features.',
      ''
    ].join('\n');
  }
}

module.exports = AiApplicationTemplate;
