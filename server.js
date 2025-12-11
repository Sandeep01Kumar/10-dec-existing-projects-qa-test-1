/**
 * Robust HTTP Server with Error Handling, Graceful Shutdown,
 * Input Validation, and Resource Cleanup
 *
 * This server implements comprehensive error handling for:
 * - Server-level errors (EADDRINUSE, EACCES)
 * - Client errors (malformed requests)
 * - Process signals (SIGTERM, SIGINT)
 * - Uncaught exceptions and unhandled rejections
 * - Connection tracking and cleanup
 * - Input validation (HTTP methods, URL length)
 */

const http = require('http');

// Server configuration
const hostname = '127.0.0.1';
const port = 3000;

// Timeout configuration constants
const SERVER_TIMEOUT = 30000;        // 30 seconds for request processing
const KEEP_ALIVE_TIMEOUT = 5000;     // 5 seconds for keep-alive connections
const HEADERS_TIMEOUT = 60000;       // 60 seconds to receive headers
const GRACEFUL_SHUTDOWN_TIMEOUT = 10000;  // 10 seconds max for graceful shutdown
const MAX_URL_LENGTH = 2048;         // Maximum URL length allowed

// Connection tracking for graceful shutdown
let isShuttingDown = false;
const activeConnections = new Set();

/**
 * Validates the incoming HTTP request
 * @param {http.IncomingMessage} req - The incoming request
 * @returns {Object} Validation result with isValid flag and optional error
 */
function validateRequest(req) {
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];

  // Validate HTTP method
  if (!validMethods.includes(req.method)) {
    return {
      isValid: false,
      statusCode: 400,
      message: 'Bad Request: Invalid HTTP method'
    };
  }

  // Validate URL length
  if (req.url && req.url.length > MAX_URL_LENGTH) {
    return {
      isValid: false,
      statusCode: 414,
      message: 'URI Too Long'
    };
  }

  return { isValid: true };
}

/**
 * Safely sends an error response
 * @param {http.ServerResponse} res - The response object
 * @param {number} statusCode - HTTP status code
 * @param {string} message - Error message
 */
function sendErrorResponse(res, statusCode, message) {
  // Don't send if headers already sent or response ended
  if (res.headersSent || res.writableEnded) {
    return;
  }

  try {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Connection', 'close');
    res.end(message + '\n');
  } catch (err) {
    // Ignore errors when sending error response
    console.error('Error sending error response:', err.message);
  }
}

// Create HTTP server with request handler
const server = http.createServer((req, res) => {
  // Reject requests during shutdown
  if (isShuttingDown) {
    sendErrorResponse(res, 503, 'Service Unavailable: Server is shutting down');
    return;
  }

  // Validate the request
  const validation = validateRequest(req);
  if (!validation.isValid) {
    sendErrorResponse(res, validation.statusCode, validation.message);
    return;
  }

  // Handle request errors
  req.on('error', (err) => {
    console.error('Request error:', err.message);
    sendErrorResponse(res, 500, 'Internal Server Error');
  });

  // Handle response errors
  res.on('error', (err) => {
    console.error('Response error:', err.message);
  });

  // Handle client disconnect during request processing
  req.on('close', () => {
    if (!res.writableEnded) {
      // Client disconnected before response was sent
      res.destroy();
    }
  });

  // Normal request handling - send Hello, World! response
  res.statusCode = 200;
  res.setHeader('Content-Type', 'text/plain');
  res.end('Hello, World!\n');
});

// Configure server timeouts
server.timeout = SERVER_TIMEOUT;
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;
server.headersTimeout = HEADERS_TIMEOUT;

// Track connections for graceful shutdown
server.on('connection', (socket) => {
  activeConnections.add(socket);

  // Remove socket from tracking when it closes
  socket.on('close', () => {
    activeConnections.delete(socket);
  });

  // Handle socket errors
  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
    activeConnections.delete(socket);
  });

  // Handle socket timeout
  socket.on('timeout', () => {
    console.log('Socket timeout - destroying connection');
    socket.destroy();
    activeConnections.delete(socket);
  });
});

// Handle client errors (malformed requests)
server.on('clientError', (err, socket) => {
  console.error('Client error:', err.message);

  if (socket.destroyed) {
    return;
  }

  let response;
  if (err.code === 'HPE_HEADER_OVERFLOW') {
    response = 'HTTP/1.1 431 Request Header Fields Too Large\r\n';
    response += 'Content-Type: text/plain\r\n';
    response += 'Connection: close\r\n\r\n';
    response += 'Request Header Fields Too Large\n';
  } else if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
    // Client disconnected, just close the socket
    socket.destroy();
    return;
  } else {
    response = 'HTTP/1.1 400 Bad Request\r\n';
    response += 'Content-Type: text/plain\r\n';
    response += 'Connection: close\r\n\r\n';
    response += 'Bad Request\n';
  }

  socket.end(response);
});

// Handle server-level errors
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${port} is already in use`);
    process.exit(1);
  } else if (err.code === 'EACCES') {
    console.error(`Error: Permission denied to bind to port ${port}`);
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    gracefulShutdown('serverError');
  }
});

// Handle server close event
server.on('close', () => {
  console.log('Server closed successfully. All connections handled.');
});

/**
 * Performs graceful shutdown of the server
 * @param {string} signal - The signal or reason for shutdown
 */
function gracefulShutdown(signal) {
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }

  console.log(`${signal} received. Starting graceful shutdown...`);
  isShuttingDown = true;

  // Stop accepting new connections
  server.close((err) => {
    if (err) {
      console.error('Error during server close:', err.message);
      process.exit(1);
    }
    process.exit(0);
  });

  // Close all active connections after a brief delay to allow ongoing responses
  setTimeout(() => {
    console.log(`Closing ${activeConnections.size} active connections...`);
    for (const socket of activeConnections) {
      socket.destroy();
    }
    activeConnections.clear();
  }, 100);

  // Force shutdown after timeout
  setTimeout(() => {
    console.error('Graceful shutdown timeout. Forcing exit...');
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT);
}

// Handle process signals for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error(err.stack);
  gracefulShutdown('uncaughtException');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

// Start the server
server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
  console.log('Server is ready to handle requests.');
  console.log('Press Ctrl+C to stop the server.');
});
