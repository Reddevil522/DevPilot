const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const TemplateFactory = require('./templates/TemplateFactory');

class ProjectGeneratorService {
  constructor(emitProgress) {
    this.emitProgress = emitProgress || (() => {});
  }

  async generate(projectPath, projectName, template, description, projectId, technology, projectType) {
    try {
      this.emitProgress('Resolving dynamic template architecture...');
      
      const templateGenerator = TemplateFactory.getTemplate(
        projectPath, 
        projectName, 
        description, 
        projectId, 
        technology, 
        template, 
        projectType, 
        this.emitProgress
      );

      await templateGenerator.generate();

      this.emitProgress('Initializing Git');
      await this.runCommand('git init', projectPath);

    } catch (error) {
      console.error('Generation Error:', error);
      throw error;
    }
  }

  async runCommand(command, cwd) {
    try {
      await execAsync(command, { cwd });
    } catch (error) {
      console.warn(`Command failed: ${command}`, error.message);
      if (!command.startsWith('git') && !command.startsWith('npm')) {
        throw error;
      }
    }
  }
}

module.exports = ProjectGeneratorService;
