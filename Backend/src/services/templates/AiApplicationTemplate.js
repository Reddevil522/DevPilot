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

    // 3. Root Files
    await this.generateRootGitignore();
    await this.generateRootReadme(`# ${this.projectName}\n\nAI Application Architecture.\n\n## Structure\n- \`frontend/\`: User interface.\n- \`backend/\`: Node.js AI-powered API with dedicated services for AI, embeddings, and prompts.\n- \`.devpilot/\`: Local project identity.\n\n**IMPORTANT**: DevPilot DOES NOT automatically install dependencies. The developer must run npm install manually.\n`);
  }
}

module.exports = AiApplicationTemplate;
