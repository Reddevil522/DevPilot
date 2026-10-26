const BaseTemplate = require('./BaseTemplate');
const AngularTemplate = require('./AngularTemplate');
const ExpressTemplate = require('./ExpressTemplate');
const path = require('path');
const fs = require('fs').promises;

class MeanTemplate extends BaseTemplate {
  async createStructure() {
    this.emitProgress('Creating MEAN Stack structure');

    // Create frontend and backend directories
    const fePath = path.join(this.projectPath, 'frontend');
    const bePath = path.join(this.projectPath, 'backend');
    await fs.mkdir(fePath, { recursive: true });
    await fs.mkdir(bePath, { recursive: true });

    const angularTemplate = new AngularTemplate(this.projectPath, this.projectName, this.description, this.projectId, this.technology, this.projectType, this.emitProgress);
    await angularTemplate.createStructure(fePath, false);

    const expressTemplate = new ExpressTemplate(this.projectPath, this.projectName, this.description, this.projectId, this.technology, this.projectType, this.emitProgress);
    await expressTemplate.createStructure(bePath, false);

    await this.generateRootGitignore();
    await this.generateRootReadme(this.buildReadme());
  }

  buildReadme() {
    return [
      `# ${this.projectName}`,
      '',
      'MEAN stack: MongoDB, Express, Angular, Node.js.',
      '',
      '## Structure',
      '```',
      '.',
      '  frontend/   Angular app (UI)',
      '  backend/    Express + Node.js REST API with MongoDB (Mongoose)',
      '  .devpilot/  local project identity (git-ignored)',
      '```',
      'Each folder has its own README with the details. Read those next.',
      '',
      '## Requirements',
      '- Node.js 20 or newer',
      '- A running MongoDB instance (local or Atlas)',
      '',
      '## Getting started',
      '> DevPilot does not install dependencies automatically. Run `npm install` in each folder yourself.',
      '',
      'Terminal 1 - backend (http://localhost:5000):',
      '```bash',
      'cd backend',
      'cp .env.example .env     # then edit the values',
      'npm install',
      'npm run dev',
      '```',
      '',
      'Terminal 2 - frontend (http://localhost:4200):',
      '```bash',
      'cd frontend',
      'npm install',
      'npm start',
      '```',
      '',
      '## How frontend and backend talk',
      '- The backend serves its API under `/api` (health check: `GET http://localhost:5000/api/health`).',
      '- The Angular app reads the API address from `frontend/src/environments/` (`apiUrl`, development value `http://localhost:5000/api`).',
      '- CORS is currently open (`cors()` in `backend/src/app.js`). `FRONTEND_URL` in `backend/.env` is not used yet; if you restrict CORS later, set it to `http://localhost:4200`.',
      '',
      '## Git',
      'A `.gitignore` is included. It keeps `node_modules`, build output, `.env` files and logs out of git. `.env.example` files are committed.',
      ''
    ].join('\n');
  }
}

module.exports = MeanTemplate;
