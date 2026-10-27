const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const errorMiddleware = require('./middleware/error.middleware');

const app = express();

// Trust reverse proxy (Render, AWS ALB, Cloudflare, Nginx)
// Required for accurate client IP detection, rate limiting, and secure cookies behind HTTPS proxies.
app.set('trust proxy', 1);

// Security Headers with Cross-Origin Resource Policy allowed for API consumers
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' }
}));

// Resolve allowed origins from environment (supports comma-separated list or single URL)
const configuredOrigins = (process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGIN || process.env.FRONTEND_URL || 'http://localhost:4200')
  .split(',')
  .map(o => o.trim().replace(/\/$/, ''))
  .filter(Boolean);

// CORS configuration supporting dynamic origins, credentials, and wildcard matching (e.g. *.vercel.app)
app.use(cors({
  origin: (origin, callback) => {
    // Allow non-browser requests (e.g. server-to-server, curl, mobile)
    if (!origin) return callback(null, true);

    const normalized = origin.replace(/\/$/, '');
    const isAllowed = configuredOrigins.some(allowed => {
      if (allowed === normalized) return true;
      if (allowed.includes('*')) {
        const pattern = new RegExp('^' + allowed.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
        return pattern.test(normalized);
      }
      return false;
    });

    if (isAllowed || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy violation: Origin ${origin} not permitted.`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin']
}));

// Body parsing Middleware
app.use(express.json({ limit: '20mb' }));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Cookie parsing Middleware
app.use(cookieParser());

// Lightweight health check endpoint for Render, load balancers, and uptime monitors
const healthHandler = (req, res) => {
  const mongoose = require('mongoose');
  const dbState = mongoose.connection.readyState;
  const dbStatus = dbState === 1 ? 'connected' : dbState === 2 ? 'connecting' : 'disconnected';

  res.status(200).json({
    status: 'ok',
    service: 'devpilot-backend',
    timestamp: new Date().toISOString(),
    uptime: Math.round(process.uptime()),
    database: dbStatus
  });
};

app.get('/', (req, res) => {
  res.status(200).json({
    status: 'ok',
    name: 'DevPilot API',
    version: '1.0.0',
    message: 'DevPilot Backend REST & WebSocket Services are online and operational.',
    health: '/health',
    endpoints: {
      auth: '/api/auth',
      projects: '/api/projects',
      ai: '/api/ai',
      terminal: '/api/terminal/ws'
    }
  });
});

app.get('/health', healthHandler);
app.get('/api/health', healthHandler);

// Import Routes
const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const fileRoutes = require('./routes/file.routes');
const aiRoutes = require('./routes/ai.routes');
const terminalRoutes = require('./routes/terminal.routes');

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', fileRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/terminal', terminalRoutes);

// Error Handling Middleware
app.use(errorMiddleware);

module.exports = app;
