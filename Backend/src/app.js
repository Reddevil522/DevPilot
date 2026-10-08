const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const errorMiddleware = require('./middleware/error.middleware');

const app = express();

// Security Headers
app.use(helmet());

// CORS configuration
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:4200',
  credentials: true,
}));

// Body parsing Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Cookie parsing Middleware
app.use(cookieParser());

// Test route
app.get('/api/health', (req, res) => {
  res.status(200).json({ success: true, message: 'API is running perfectly.' });
});

// Import Routes
const authRoutes = require('./routes/auth.routes');
const projectRoutes = require('./routes/project.routes');
const fileRoutes = require('./routes/file.routes');

app.use('/api/auth', authRoutes);
app.use('/api/projects', projectRoutes);
app.use('/api/projects', fileRoutes);

// Error Handling Middleware
app.use(errorMiddleware);

module.exports = app;
