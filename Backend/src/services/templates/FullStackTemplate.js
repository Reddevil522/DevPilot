const BaseTemplate = require('./BaseTemplate');
const MeanTemplate = require('./MeanTemplate');
const MernTemplate = require('./MernTemplate');

class FullStackTemplate extends BaseTemplate {
  async createStructure() {
    this.emitProgress('Creating Full Stack structure');

    // Determine the stack based on technology
    if (this.technology && this.technology.toLowerCase() === 'react') {
      const mernTemplate = new MernTemplate(this.projectPath, this.projectName, this.description, this.projectId, this.technology, this.projectType, this.emitProgress);
      // Let MernTemplate take over completely (it handles .gitignore, README, and directories)
      await mernTemplate.createStructure();
    } else {
      // Default to MEAN for Angular or undefined
      const meanTemplate = new MeanTemplate(this.projectPath, this.projectName, this.description, this.projectId, this.technology, this.projectType, this.emitProgress);
      await meanTemplate.createStructure();
    }
  }
}

module.exports = FullStackTemplate;
