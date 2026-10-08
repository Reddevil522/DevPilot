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
    await this.generateRootReadme(`# ${this.projectName}\n\nMEAN Stack Architecture.\n\n## Structure\n- \`frontend/\`: Angular application.\n- \`backend/\`: Express + Node.js API.\n- \`.devpilot/\`: Local project identity.\n\n**IMPORTANT**: DevPilot DOES NOT automatically install dependencies. The developer must run npm install manually.\n\n## Frontend\ncd frontend\nnpm install\nnpm start\n\n## Backend\ncd backend\nnpm install\nnpm run dev\n`);
  }
}

module.exports = MeanTemplate;
