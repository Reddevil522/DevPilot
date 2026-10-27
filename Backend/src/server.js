require('dotenv').config();
const http = require('http');
const app = require('./app');
const mongoose = require('mongoose');
const { attachTerminalWss } = require('./controllers/terminal.controller');
const terminalService = require('./services/terminal.service');

const PORT = process.env.PORT || 5000;
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('FATAL ERROR: MONGODB_URI is not defined.');
  process.exit(1);
}

// Wrap Express in a plain Node HTTP server so we can attach the WS server
// to the same port without requiring a separate port or a second process.
const httpServer = http.createServer(app);

// Attach the terminal WebSocket server BEFORE listening
attachTerminalWss(httpServer);

// Connect to MongoDB, then start listening
mongoose
  .connect(MONGODB_URI)
  .then(() => {
    console.log('Successfully connected to MongoDB.');

    httpServer.listen(PORT, '0.0.0.0', () => {
      console.log(`Server is running on port ${PORT} (0.0.0.0)`);
    });
  })
  .catch((err) => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Graceful shutdown: destroy all PTY sessions before the process exits
// so no orphan shells are left running.
function gracefulShutdown(signal) {
  console.log(`[Server] Received ${signal} — shutting down gracefully.`);
  terminalService.destroyAll();
  httpServer.close(() => {
    mongoose.connection.close(false).then(() => {
      console.log('[Server] Clean shutdown complete.');
      process.exit(0);
    });
  });

  // Force-exit after 10 s if something blocks shutdown
  setTimeout(() => {
    console.error('[Server] Graceful shutdown timed out — forcing exit.');
    process.exit(1);
  }, 10_000).unref();
}

process.once('SIGINT', () => gracefulShutdown('SIGINT'));
process.once('SIGTERM', () => gracefulShutdown('SIGTERM'));

