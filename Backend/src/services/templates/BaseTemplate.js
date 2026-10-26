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

  // Git does not track empty folders, so drop a .gitkeep in each one.
  async createGitkeeps(basePath, dirs) {
    for (const dir of dirs) {
      await this.createFile(basePath, `${dir}/.gitkeep`, '');
    }
  }

  async generateEditorConfig(dir = this.projectPath) {
    const content = [
      'root = true',
      '',
      '[*]',
      'charset = utf-8',
      'end_of_line = lf',
      'indent_style = space',
      'indent_size = 2',
      'insert_final_newline = true',
      'trim_trailing_whitespace = true',
      '',
      '[*.md]',
      'trim_trailing_whitespace = false',
      ''
    ].join('\n');
    await this.createFile(dir, '.editorconfig', content);
  }

  async generateRootGitignore(extraLines = []) {
    const lines = [
      '# Dependencies',
      'node_modules/',
      'frontend/node_modules/',
      'backend/node_modules/',
      '',
      '# Build output',
      'dist/',
      'build/',
      'out-tsc/',
      '.angular/',
      '.vite/',
      '*.tsbuildinfo',
      '',
      '# Test / coverage',
      'coverage/',
      '',
      '# Environment variables (keep .env.example)',
      '.env',
      '.env.*',
      '!.env.example',
      '',
      '# Logs',
      'logs/',
      '*.log',
      'npm-debug.log*',
      'yarn-debug.log*',
      'yarn-error.log*',
      'pnpm-debug.log*',
      '',
      '# Caches',
      '.cache/',
      '.eslintcache',
      '',
      '# Local project identity',
      '.devpilot/',
      '',
      '# OS files',
      '.DS_Store',
      'Thumbs.db',
      '',
      '# Editors / IDEs',
      '.idea/',
      '.vscode/*',
      '!.vscode/extensions.json',
      '*.swp',
      ...(extraLines.length ? ['', '# Extra', ...extraLines] : [])
    ];
    await this.createFile(this.projectPath, '.gitignore', lines.join('\n') + '\n');
  }

  async generateRootReadme(content) {
    await this.createFile(this.projectPath, 'README.md', content);
  }
}

module.exports = BaseTemplate;
