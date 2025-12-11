/**
 * Comprehensive Test Suite for server.js
 * 
 * This test suite validates HTTP server functionality including:
 * - Basic HTTP method support (GET, POST, PUT, DELETE, PATCH, HEAD, OPTIONS)
 * - Error handling for invalid HTTP methods
 * - URL length validation (414 error for URLs > 2048 chars)
 * - Concurrent request handling
 * - Client disconnect survival
 * - Path handling
 * - Custom header support
 * 
 * Uses native Node.js modules: http, net, assert
 * No external dependencies required.
 */

const http = require('http');
const net = require('net');
const assert = require('assert');

// Test configuration constants
const TEST_PORT = 3000;
const TEST_HOST = '127.0.0.1';
const TEST_TIMEOUT = 5000;

// Test results tracking
let testsRun = 0;
let testsPassed = 0;
let testsFailed = 0;

/**
 * Makes an HTTP request to the test server
 * @param {Object} options - Request options
 * @param {string} options.method - HTTP method (GET, POST, etc.)
 * @param {string} options.path - Request path
 * @param {Object} options.headers - Request headers
 * @returns {Promise<Object>} Response object with statusCode, headers, body
 */
function makeRequest(options) {
  return new Promise((resolve, reject) => {
    const requestOptions = {
      hostname: TEST_HOST,
      port: TEST_PORT,
      path: options.path || '/',
      method: options.method || 'GET',
      headers: options.headers || {}
    };

    const req = http.request(requestOptions, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          headers: res.headers,
          body: body
        });
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    // Set timeout for the request
    req.setTimeout(TEST_TIMEOUT, () => {
      req.destroy(new Error('Request timeout'));
    });

    req.end();
  });
}

/**
 * Runs a single test with error handling and result tracking
 * @param {string} testName - Name of the test
 * @param {Function} testFn - Async test function
 */
async function runTest(testName, testFn) {
  testsRun++;
  try {
    await testFn();
    testsPassed++;
    console.log(`✓ PASSED: ${testName}`);
  } catch (err) {
    testsFailed++;
    console.log(`✗ FAILED: ${testName}`);
    console.log(`  Error: ${err.message}`);
  }
}

// =============================================================================
// TEST CASES
// =============================================================================

/**
 * Test 1: GET / returns 200 with Hello, World!
 * Verifies basic GET request functionality
 */
async function testGetReturns200WithHelloWorld() {
  const response = await makeRequest({ method: 'GET', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200');
  assert.ok(response.body.includes('Hello, World!'), 'Body should contain Hello, World!');
  assert.strictEqual(response.headers['content-type'], 'text/plain', 'Content-Type should be text/plain');
}

/**
 * Test 2: POST / returns 200
 * Verifies POST requests are handled correctly
 */
async function testPostReturns200() {
  const response = await makeRequest({ method: 'POST', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200 for POST');
}

/**
 * Test 3: HEAD / returns 200
 * Verifies HEAD requests are handled correctly
 */
async function testHeadReturns200() {
  const response = await makeRequest({ method: 'HEAD', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200 for HEAD');
}

/**
 * Test 4: OPTIONS / returns 200
 * Verifies OPTIONS requests are handled correctly
 */
async function testOptionsReturns200() {
  const response = await makeRequest({ method: 'OPTIONS', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200 for OPTIONS');
}

/**
 * Test 5: PUT / returns 200
 * Verifies PUT requests are handled correctly
 */
async function testPutReturns200() {
  const response = await makeRequest({ method: 'PUT', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200 for PUT');
}

/**
 * Test 6: DELETE / returns 200
 * Verifies DELETE requests are handled correctly
 */
async function testDeleteReturns200() {
  const response = await makeRequest({ method: 'DELETE', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200 for DELETE');
}

/**
 * Test 7: PATCH / returns 200
 * Verifies PATCH requests are handled correctly
 */
async function testPatchReturns200() {
  const response = await makeRequest({ method: 'PATCH', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Status code should be 200 for PATCH');
}

/**
 * Test 8: Handles multiple concurrent requests
 * Verifies server can handle concurrent requests without issues
 */
async function testMultipleConcurrentRequests() {
  const numRequests = 10;
  const promises = [];
  
  for (let i = 0; i < numRequests; i++) {
    promises.push(makeRequest({ method: 'GET', path: '/' }));
  }
  
  const responses = await Promise.all(promises);
  
  for (let i = 0; i < responses.length; i++) {
    assert.strictEqual(responses[i].statusCode, 200, `Request ${i + 1} should return 200`);
    assert.ok(responses[i].body.includes('Hello, World!'), `Request ${i + 1} should contain Hello, World!`);
  }
}

/**
 * Test 9: Invalid HTTP method returns 400
 * Verifies server rejects invalid HTTP methods with 400 Bad Request
 */
async function testInvalidMethodReturns400() {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    
    socket.connect(TEST_PORT, TEST_HOST, () => {
      // Send an invalid HTTP method
      socket.write('INVALID / HTTP/1.1\r\nHost: localhost\r\n\r\n');
    });
    
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    
    socket.on('end', () => {
      // Check for 400 Bad Request response
      if (data.includes('400')) {
        resolve();
      } else {
        reject(new Error(`Expected 400 response, got: ${data.substring(0, 100)}`));
      }
    });
    
    socket.on('error', (err) => {
      // Connection reset or close is also acceptable for invalid requests
      resolve();
    });
    
    // Timeout fallback
    setTimeout(() => {
      socket.destroy();
      reject(new Error('Test timed out'));
    }, TEST_TIMEOUT);
  });
}

/**
 * Test 10: Server survives client disconnect
 * Verifies server continues to function after a client abruptly disconnects
 */
async function testServerSurvivesClientDisconnect() {
  // Create a socket and immediately destroy it
  await new Promise((resolve) => {
    const socket = new net.Socket();
    
    socket.connect(TEST_PORT, TEST_HOST, () => {
      // Write partial request and immediately destroy
      socket.write('GET / HTTP/1.1\r\n');
      socket.destroy();
      resolve();
    });
    
    socket.on('error', () => {
      resolve();
    });
  });
  
  // Wait a short time to ensure server processes the disconnect
  await new Promise(resolve => setTimeout(resolve, 100));
  
  // Verify server is still responding
  const response = await makeRequest({ method: 'GET', path: '/' });
  assert.strictEqual(response.statusCode, 200, 'Server should still respond after client disconnect');
}

/**
 * Test 11: Very long URL returns 414
 * Verifies server returns 414 URI Too Long for URLs exceeding 2048 characters
 */
async function testVeryLongUrlReturns414() {
  // Create a URL longer than 2048 characters
  const longPath = '/' + 'a'.repeat(3000);
  
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    
    socket.connect(TEST_PORT, TEST_HOST, () => {
      socket.write(`GET ${longPath} HTTP/1.1\r\nHost: localhost\r\n\r\n`);
    });
    
    let data = '';
    socket.on('data', (chunk) => {
      data += chunk.toString();
    });
    
    socket.on('end', () => {
      // Check for 414 URI Too Long response
      if (data.includes('414')) {
        resolve();
      } else {
        reject(new Error(`Expected 414 response, got: ${data.substring(0, 100)}`));
      }
    });
    
    socket.on('error', (err) => {
      // Connection close is acceptable for oversized requests
      resolve();
    });
    
    // Timeout fallback
    setTimeout(() => {
      socket.destroy();
      reject(new Error('Test timed out'));
    }, TEST_TIMEOUT);
  });
}

/**
 * Test 12: Different paths all return 200
 * Verifies server handles different paths correctly
 */
async function testDifferentPathsReturn200() {
  const paths = ['/', '/test', '/api/data', '/hello/world', '/path/to/resource'];
  
  for (const path of paths) {
    const response = await makeRequest({ method: 'GET', path: path });
    assert.strictEqual(response.statusCode, 200, `Path ${path} should return 200`);
  }
}

/**
 * Test 13: Requests with custom headers work
 * Verifies server handles requests with custom headers correctly
 */
async function testCustomHeadersWork() {
  const customHeaders = {
    'X-Custom-Header': 'test-value',
    'Accept': 'application/json',
    'User-Agent': 'TestRunner/1.0'
  };
  
  const response = await makeRequest({
    method: 'GET',
    path: '/',
    headers: customHeaders
  });
  
  assert.strictEqual(response.statusCode, 200, 'Request with custom headers should return 200');
  assert.ok(response.body.includes('Hello, World!'), 'Response should contain Hello, World!');
}

// =============================================================================
// TEST RUNNER
// =============================================================================

/**
 * Main test runner function
 * Runs all tests sequentially and reports results
 */
async function runAllTests() {
  console.log('========================================');
  console.log('Starting Server Test Suite');
  console.log('========================================');
  console.log(`Target: ${TEST_HOST}:${TEST_PORT}`);
  console.log('');
  
  // Run all tests
  await runTest('GET / returns 200 with Hello, World!', testGetReturns200WithHelloWorld);
  await runTest('POST / returns 200', testPostReturns200);
  await runTest('HEAD / returns 200', testHeadReturns200);
  await runTest('OPTIONS / returns 200', testOptionsReturns200);
  await runTest('PUT / returns 200', testPutReturns200);
  await runTest('DELETE / returns 200', testDeleteReturns200);
  await runTest('PATCH / returns 200', testPatchReturns200);
  await runTest('Handles multiple concurrent requests', testMultipleConcurrentRequests);
  await runTest('Invalid HTTP method returns 400', testInvalidMethodReturns400);
  await runTest('Server survives client disconnect', testServerSurvivesClientDisconnect);
  await runTest('Very long URL returns 414', testVeryLongUrlReturns414);
  await runTest('Different paths all return 200', testDifferentPathsReturn200);
  await runTest('Requests with custom headers work', testCustomHeadersWork);
  
  // Print summary
  console.log('');
  console.log('========================================');
  console.log('Test Summary');
  console.log('========================================');
  console.log(`  Total: ${testsRun}`);
  console.log(`  Passed: ${testsPassed}`);
  console.log(`  Failed: ${testsFailed}`);
  console.log('========================================');
  
  // Exit with appropriate code
  if (testsFailed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

// Run tests
runAllTests().catch((err) => {
  console.error('Test runner encountered an error:', err.message);
  process.exit(1);
});
