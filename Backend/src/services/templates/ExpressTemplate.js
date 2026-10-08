const BaseTemplate = require('./BaseTemplate');
const path = require('path');

class ExpressTemplate extends BaseTemplate {
  async createStructure(targetDir = this.projectPath, isStandalone = true) {
    this.emitProgress(`Creating Express MVC structure in ${path.basename(targetDir) || 'root'}`);

    const dirs = [
      'src/config',
      'src/controllers',
      'src/models',
      'src/routes',
      'src/middleware',
      'src/services',
      'src/validators',
      'src/utils',
      'src/constants'
    ];
    await this.createDirectories(targetDir, dirs);
    await this.generateExpressFiles(targetDir);

    if (isStandalone) {
      await this.generateRootGitignore();
      await this.generateRootReadme(`# ${this.projectName}\n\nExpress + Node.js Backend API.\n\n## Architecture\n- \`src/config/\`: Database connection\n- \`src/controllers/\`: Request/response handling\n- \`src/models/\`: Database models\n- \`src/routes/\`: Express routes\n- \`src/services/\`: Business logic\n- \`src/middleware/\`: Express middleware\n- \`src/validators/\`: Request validation\n\nRequest flow: Route -> Middleware -> Controller -> Service -> Model -> Database\n`);
    } else {
      await this.createFile(targetDir, 'README.md', `# Backend\n\nExpress + Node.js Backend API.\n\n## Architecture\n- \`src/config/\`: Database connection\n- \`src/controllers/\`: Request/response handling\n- \`src/models/\`: Database models\n- \`src/routes/\`: Express routes\n- \`src/services/\`: Business logic\n- \`src/middleware/\`: Express middleware\n- \`src/validators/\`: Request validation\n\nRequest flow: Route -> Middleware -> Controller -> Service -> Model -> Database\n`);
    }
  }

  async generateExpressFiles(dir) {
    await this.createFile(dir, 'package.json', JSON.stringify({
      name: `${this.projectName}-backend`,
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
        "helmet": "^8.3.0",
        "mongoose": "^9.10.1",
        "zod": "^3.22.4"
      },
      devDependencies: {
        "nodemon": "^3.1.14"
      }
    }, null, 2));

    await this.createFile(dir, '.env.example', `PORT=5000\nMONGODB_URI=mongodb://localhost:27017/${this.projectName.replace(/\s+/g, '_').toLowerCase()}\nJWT_SECRET=replace_with_secure_secret\nFRONTEND_URL=http://localhost:4200\n`);
    
    await this.createFile(dir, 'src/config/database.js', `const mongoose = require('mongoose');\n\nconst connectDB = async () => {\n  try {\n    const conn = await mongoose.connect(process.env.MONGODB_URI);\n    console.log(\`MongoDB Connected: \${conn.connection.host}\`);\n  } catch (error) {\n    console.error(\`Error: \${error.message}\`);\n    process.exit(1);\n  }\n};\n\nmodule.exports = connectDB;\n`);
    
    await this.createFile(dir, 'src/controllers/health.controller.js', `exports.getHealth = (req, res) => {\n  res.status(200).json({\n    success: true,\n    message: 'API is running'\n  });\n};\n`);
    await this.createFile(dir, 'src/routes/health.routes.js', `const express = require('express');\nconst { getHealth } = require('../controllers/health.controller');\n\nconst router = express.Router();\n\nrouter.route('/').get(getHealth);\n\nmodule.exports = router;\n`);
    await this.createFile(dir, 'src/middleware/error.middleware.js', `exports.errorHandler = (err, req, res, next) => {\n  console.error(err.stack);\n  res.status(500).json({ success: false, message: 'Server Error' });\n};\n`);
    
    await this.createFile(dir, 'src/app.js', `const express = require('express');\nconst cors = require('cors');\nconst helmet = require('helmet');\nconst healthRoutes = require('./routes/health.routes');\nconst { errorHandler } = require('./middleware/error.middleware');\n\nconst app = express();\n\n// Middleware\napp.use(helmet());\napp.use(cors());\napp.use(express.json());\n\n// Routes\napp.use('/api/health', healthRoutes);\n\n// Error handling middleware\napp.use(errorHandler);\n\nmodule.exports = app;\n`);
    await this.createFile(dir, 'src/server.js', `require('dotenv').config();\nconst app = require('./app');\nconst connectDB = require('./config/database');\n\nconst PORT = process.env.PORT || 5000;\n\n// Connect to database\nconnectDB().then(() => {\n  app.listen(PORT, () => {\n    console.log(\`Server running on port \${PORT}\`);\n  });\n});\n`);
  }
}

module.exports = ExpressTemplate;
