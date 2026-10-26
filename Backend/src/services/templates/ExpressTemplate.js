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

    // Helpers that are not wired into app.js, so the existing server behaviour is unchanged
    await this.createFile(targetDir, 'src/utils/asyncHandler.js', [
      '// Wrap async route handlers so rejected promises reach the error middleware.',
      '// Usage: router.get(\'/\', asyncHandler(controller.list));',
      'module.exports = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);',
      ''
    ].join('\n'));

    // Keep empty folders in git
    await this.createGitkeeps(targetDir, [
      'src/models',
      'src/services',
      'src/validators',
      'src/constants'
    ]);
    await this.generateEditorConfig(targetDir);

    if (isStandalone) {
      await this.generateRootGitignore();
      await this.generateRootReadme(this.buildReadme(this.projectName));
    } else {
      await this.createFile(targetDir, 'README.md', this.buildReadme('Backend'));
    }
  }

  buildReadme(heading) {
    const dbName = this.projectName.replace(/\s+/g, '_').toLowerCase();
    return [
      `# ${heading}`,
      '',
      'Express + Node.js REST API with MongoDB (Mongoose), organised as a layered MVC structure.',
      '',
      '## Requirements',
      '- Node.js 20 or newer',
      '- A running MongoDB instance (local or Atlas). The server exits if it cannot connect.',
      '',
      '## Getting started',
      '```bash',
      'cp .env.example .env     # then edit the values',
      'npm install',
      'npm run dev              # nodemon, auto-restart on changes',
      '```',
      'The API starts on `http://localhost:5000` and the health check is at `GET /api/health`.',
      '',
      '> DevPilot does not install dependencies automatically. Run `npm install` yourself.',
      '',
      '## Scripts',
      '| Command | What it does |',
      '| --- | --- |',
      '| `npm run dev` | Start with nodemon (development) |',
      '| `npm start` | Start with node (production) |',
      '',
      '## Environment variables (`.env`)',
      '| Variable | Default in `.env.example` | Purpose |',
      '| --- | --- | --- |',
      '| `PORT` | `5000` | Port the server listens on |',
      `| \`MONGODB_URI\` | \`mongodb://localhost:27017/${dbName}\` | MongoDB connection string |`,
      '| `JWT_SECRET` | `replace_with_secure_secret` | Secret for signing tokens. Change it before real use |',
      '| `FRONTEND_URL` | `http://localhost:4200` | Frontend origin (for CORS if you restrict it later) |',
      '',
      '`.env` is git-ignored. Only `.env.example` is committed.',
      '',
      '## Folder structure',
      '```',
      'src/',
      '  config/        database connection and other setup',
      '  controllers/   read the request, call a service, send the response',
      '  services/      business logic (no req/res in here)',
      '  models/        Mongoose schemas',
      '  routes/        URL -> controller mapping',
      '  middleware/    error handling, auth, etc.',
      '  validators/    request validation (zod is installed)',
      '  utils/         small helpers (asyncHandler.js included)',
      '  constants/     shared constant values',
      '  app.js         Express app: middleware + routes',
      '  server.js      loads .env, connects to MongoDB, starts listening',
      '```',
      '',
      '## Request flow',
      '`Route -> Middleware -> Controller -> Service -> Model -> Database`',
      '',
      '## Adding a new feature (example: users)',
      '1. `models/user.model.js` - define the schema',
      '2. `services/user.service.js` - business logic',
      '3. `controllers/user.controller.js` - handle req/res',
      '4. `routes/user.routes.js` - define the endpoints',
      '5. Mount it in `src/app.js`: `app.use(\'/api/users\', userRoutes);`',
      '',
      '## Endpoints',
      '| Method | Path | Description |',
      '| --- | --- | --- |',
      '| GET | `/api/health` | Returns `{ success: true, message: \'API is running\' }` |',
      ''
    ].join('\n');
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
