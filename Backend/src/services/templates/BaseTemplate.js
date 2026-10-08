const fs = require('fs').promises;
const path = require('path');

class BaseTemplate {
  constructor(projectPath, projectName, description, projectId, technology, projectType, emitProgress) {
    this.projectPath = projectPath;
    this.projectName = projectName;
    this.description = description;
    this.projectId = projectId;
    this.technology = technology;
    this.projectType = projectType;
    this.emitProgress = emitProgress || (() => {});
  }

  async generate() {
    this.emitProgress('Creating project directory');
    await fs.mkdir(this.projectPath, { recursive: true });

    if (this.projectId) {
      this.emitProgress('Creating local project identity');
      const devpilotPath = path.join(this.projectPath, '.devpilot');
      await fs.mkdir(devpilotPath, { recursive: true });
      await this.createFile(devpilotPath, 'project.json', JSON.stringify({ projectId: this.projectId, version: 1 }, null, 2));
    }

    await this.createStructure();
  }

  async createStructure() {
    throw new Error('createStructure() must be implemented by subclasses');
  }

  async createFile(dir, filename, content) {
    const fullPath = path.join(dir, filename);
    await fs.writeFile(fullPath, content, 'utf8');
  }

  async createDirectories(basePath, dirs) {
    for (const dir of dirs) {
      await fs.mkdir(path.join(basePath, dir), { recursive: true });
    }
  }

  async generateRootGitignore(extraLines = []) {
    const lines = [
      'node_modules/',
      'dist/',
      'build/',
      'coverage/',
      '.angular/',
      '.env',
      '.env.*',
      '!.env.example',
      'logs/',
      '*.log',
      '.devpilot/',
      '.DS_Store',
      'frontend/node_modules/',
      'backend/node_modules/',
      ...extraLines
    ];
    await this.createFile(this.projectPath, '.gitignore', lines.join('\n') + '\n');
  }

  async generateRootReadme(content) {
    await this.createFile(this.projectPath, 'README.md', content);
  }
}

module.exports = BaseTemplate;
