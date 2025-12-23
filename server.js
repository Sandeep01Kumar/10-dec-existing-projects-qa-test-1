/**
 * Robust HTTP Server Implementation
 * 
 * A production-ready Node.js HTTP server with comprehensive error handling,
 * graceful shutdown, input validation, connection tracking, and resource cleanup.
 */
const http = require('http');

// Server configuration constants
const hostname = '127.0.0.1';
const port = 3000;

// Timeout configuration constants (in milliseconds)
const SERVER_TIMEOUT = 30000;           // 30 seconds - maximum time for request processing
const KEEP_ALIVE_TIMEOUT = 5000;        // 5 seconds - time to keep connection alive after response
const HEADERS_TIMEOUT = 60000;          // 60 seconds - time allowed to receive headers
const GRACEFUL_SHUTDOWN_TIMEOUT = 10000; // 10 seconds - maximum time to wait for connections to close
const MAX_URL_LENGTH = 2048;            // Maximum allowed URL length

// Connection tracking state
let isShuttingDown = false;             // Flag to indicate server is shutting down
const activeConnections = new Set();    // Track all active socket connections

/**
 * Validates incoming HTTP requests for method and URL constraints.
 * 
 * @param {http.IncomingMessage} req - The incoming HTTP request object
 * @returns {Object} Validation result with isValid flag and optional error details
 */
function validateRequest(req) {
  // List of valid HTTP methods that this server accepts
  const validMethods = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'HEAD', 'OPTIONS'];
  
  // Validate HTTP method
  if (!validMethods.includes(req.method)) {
    return {
      isValid: false,
      statusCode: 400,
      message: 'Bad Request: Invalid HTTP method'
    };
  }
  
  // Validate URL length to prevent buffer overflow and resource exhaustion attacks
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
 * Safely sends an error response to the client.
 * Handles cases where headers may have already been sent or connection is closed.
 * 
 * @param {http.ServerResponse} res - The HTTP response object
 * @param {number} statusCode - HTTP status code to send
 * @param {string} message - Error message to include in response body
 */
function sendErrorResponse(res, statusCode, message) {
  // Check if response can still be written
  if (res.headersSent || res.writableEnded) {
    return;
  }
  
  try {
    res.statusCode = statusCode;
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Connection', 'close');
    res.end(message + '\n');
  } catch (err) {
    // Silently handle any errors during error response
    // This can happen if the connection was closed unexpectedly
    console.error('Error sending error response:', err.message);
  }
}

/**
 * Main HTTP request handler with comprehensive error handling.
 * Processes incoming requests and sends appropriate responses.
 * 
 * @param {http.IncomingMessage} req - The incoming HTTP request object
 * @param {http.ServerResponse} res - The HTTP response object
 */
const server = http.createServer((req, res) => {
  // Reject all requests during shutdown with 503 Service Unavailable
  if (isShuttingDown) {
    sendErrorResponse(res, 503, 'Service Unavailable: Server is shutting down');
    return;
  }
  
  // Validate the incoming request
  const validation = validateRequest(req);
  if (!validation.isValid) {
    sendErrorResponse(res, validation.statusCode, validation.message);
    return;
  }
  
  // Handle request-level errors (e.g., client aborts request)
  req.on('error', (err) => {
    console.error('Request error:', err.message);
    sendErrorResponse(res, 400, 'Bad Request');
  });
  
  // Handle response-level errors (e.g., connection issues during response)
  res.on('error', (err) => {
    console.error('Response error:', err.message);
  });
  
  // Handle client disconnect - no action needed as server handles this gracefully
  // The 'close' event fires when the underlying connection was terminated
  req.on('close', () => {
    // Log if response wasn't completed (useful for debugging)
    if (!res.writableEnded && process.env.DEBUG) {
      console.log('Client disconnected before response completed');
    }
  });
  
  // Send successful response
  try {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Hello, World!\n');
  } catch (err) {
    console.error('Error sending response:', err.message);
    sendErrorResponse(res, 500, 'Internal Server Error');
  }
});

// Configure server timeouts to prevent resource exhaustion
server.timeout = SERVER_TIMEOUT;                // Time to wait for request to complete
server.keepAliveTimeout = KEEP_ALIVE_TIMEOUT;   // Time to keep connection alive
server.headersTimeout = HEADERS_TIMEOUT;        // Time to wait for headers

/**
 * Connection tracking handler.
 * Tracks all incoming socket connections for graceful shutdown management.
 */
server.on('connection', (socket) => {
  // Add socket to active connections set
  activeConnections.add(socket);
  
  // Handle socket errors to prevent crashes
  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
  
  // Remove socket from tracking when it closes
  socket.on('close', () => {
    activeConnections.delete(socket);
  });
  
  // Handle socket timeout
  socket.on('timeout', () => {
    console.warn('Socket timeout - destroying connection');
    socket.destroy();
    activeConnections.delete(socket);
  });
});

/**
 * Client error handler.
 * Handles malformed HTTP requests, invalid headers, and connection issues.
 */
server.on('clientError', (err, socket) => {
  console.error('Client error:', err.message);
  
  // Check if socket is still writable before sending response
  if (socket.writable) {
    // Handle specific error types
    if (err.code === 'HPE_HEADER_OVERFLOW') {
      // Request headers too large
      socket.end('HTTP/1.1 431 Request Header Fields Too Large\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nRequest Header Fields Too Large\n');
    } else if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
      // Connection was reset or broken pipe - just destroy the socket
      socket.destroy();
    } else {
      // Generic bad request response
      socket.end('HTTP/1.1 400 Bad Request\r\nContent-Type: text/plain\r\nConnection: close\r\n\r\nBad Request\n');
    }
  }
  
  // Ensure socket is removed from tracking
  activeConnections.delete(socket);
});

/**
 * Server error handler.
 * Handles server-level errors like port conflicts and permission issues.
 */
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Error: Port ${port} is already in use`);
    console.error('Please stop the other process or use a different port');
    process.exit(1);
  } else if (err.code === 'EACCES') {
    console.error(`Error: Permission denied to bind to port ${port}`);
    console.error('Try using a port number greater than 1024 or run with elevated privileges');
    process.exit(1);
  } else {
    console.error('Server error:', err.message);
    // For other errors, attempt graceful shutdown
    gracefulShutdown('serverError');
  }
});

/**
 * Server close event handler.
 * Logs when the server has finished closing.
 */
server.on('close', () => {
  console.log('Server closed successfully. All connections handled.');
});

/**
 * Graceful shutdown function.
 * Stops accepting new connections and waits for existing connections to close.
 * Forces shutdown after timeout if connections don't close gracefully.
 * 
 * @param {string} signal - The signal or reason that triggered shutdown
 */
function gracefulShutdown(signal) {
  // Prevent multiple shutdown attempts
  if (isShuttingDown) {
    console.log('Shutdown already in progress...');
    return;
  }
  
  isShuttingDown = true;
  console.log(`${signal} received. Starting graceful shutdown...`);
  console.log(`Active connections: ${activeConnections.size}`);
  
  // Set a force shutdown timeout
  const forceShutdownTimeout = setTimeout(() => {
    console.error('Graceful shutdown timed out. Forcing shutdown...');
    console.log(`Forcefully closing ${activeConnections.size} remaining connections`);
    
    // Forcefully destroy all remaining connections
    activeConnections.forEach((socket) => {
      try {
        socket.destroy();
      } catch (err) {
        console.error('Error destroying socket:', err.message);
      }
    });
    
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT);
  
  // Don't let the timeout prevent process from exiting
  forceShutdownTimeout.unref();
  
  // Stop accepting new connections and close the server
  server.close((err) => {
    if (err) {
      console.error('Error closing server:', err.message);
      clearTimeout(forceShutdownTimeout);
      process.exit(1);
    }
    
    clearTimeout(forceShutdownTimeout);
    console.log('Server shutdown complete');
    process.exit(0);
  });
  
  // Close all active connections gracefully
  // Set a short timeout on sockets to allow pending requests to complete
  activeConnections.forEach((socket) => {
    if (!socket.destroyed) {
      // Set a shorter timeout to speed up shutdown
      socket.setTimeout(5000, () => {
        socket.destroy();
      });
    }
  });
}

// Process signal handlers for graceful shutdown
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

/**
 * Global uncaught exception handler.
 * Logs the error and attempts graceful shutdown.
 * Note: Best practice is to exit after uncaught exception as application state may be corrupted.
 */
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err.message);
  console.error('Stack:', err.stack);
  gracefulShutdown('uncaughtException');
});

/**
 * Global unhandled promise rejection handler.
 * Logs the rejection reason for debugging purposes.
 */
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise);
  console.error('Reason:', reason);
});

// Start the server and begin listening for connections
server.listen(port, hostname, () => {
  console.log(`Server running at http://${hostname}:${port}/`);
  console.log(`Process ID: ${process.pid}`);
  console.log('Press Ctrl+C to stop the server');
});
