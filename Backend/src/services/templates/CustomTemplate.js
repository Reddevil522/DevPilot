const BaseTemplate = require('./BaseTemplate');

class CustomTemplate extends BaseTemplate {
  async createStructure() {
    this.emitProgress('Creating Custom Project structure');

    await this.createFile(this.projectPath, 'package.json', JSON.stringify({
      name: `${this.projectName.toLowerCase().replace(/\s+/g, '-')}-custom`,
      version: "1.0.0",
      description: this.description || "A custom DevPilot project",
      scripts: {
        "start": "echo \"Error: no start script specified\" && exit 1"
      }
    }, null, 2));

    await this.generateRootGitignore();
    await this.generateEditorConfig();
    await this.generateRootReadme(this.buildReadme());
  }

  buildReadme() {
    return [
      `# ${this.projectName}`,
      '',
      'Custom Project.',
      '',
      'This is a minimal, flexible project. Shape the structure to fit your idea.',
      '',
      '## What is included',
      '| File | Purpose |',
      '| --- | --- |',
      '| `package.json` | Project metadata and scripts. The `start` script is a placeholder, replace it |',
      '| `.gitignore` | Keeps `node_modules`, build output, `.env` files and logs out of git |',
      '| `.editorconfig` | Same indentation and line endings in every editor |',
      '| `README.md` | This file |',
      '',
      '## Getting started',
      '1. Add your code (for example `src/index.js`).',
      '2. Set a real `start` script in `package.json`, for example `"start": "node src/index.js"`.',
      '3. Install any packages you need: `npm install <package>`.',
      '4. Keep secrets in a `.env` file (git-ignored) and commit a `.env.example` listing the variable names.',
      '',
      '> DevPilot does not install dependencies automatically. Run `npm install` yourself.',
      ''
    ].join('\n');
  }
}

module.exports = CustomTemplate;
