const BaseTemplate = require('./BaseTemplate');

class BlankTemplate extends BaseTemplate {
  async createStructure() {
    this.emitProgress('Creating Blank Project structure');

    await this.createFile(this.projectPath, 'package.json', JSON.stringify({
      name: `${this.projectName.toLowerCase().replace(/\s+/g, '-')}-blank`,
      version: "1.0.0",
      description: this.description || "A blank DevPilot project",
      scripts: {
        "start": "echo \"Error: no start script specified\" && exit 1"
      }
    }, null, 2));

    await this.generateRootGitignore();
    await this.generateRootReadme(`# ${this.projectName}\n\nBlank Project.\n\nThis is a minimal starting point. You can create your own custom architecture here.\n`);
  }
}

module.exports = BlankTemplate;
