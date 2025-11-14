/**
 * Example Electron integration for CoLRev JSON-RPC server
 * This demonstrates how to start the server and communicate with it from Electron.
 */

const { spawn } = require('child_process');
const http = require('http');

/**
 * CoLRev JSON-RPC Client for Node.js/Electron
 */
class CoLRevClient {
  constructor(host = '127.0.0.1', port = 8765) {
    this.host = host;
    this.port = port;
    this.url = `http://${host}:${port}`;
    this.requestId = 0;
  }

  /**
   * Make a JSON-RPC call
   */
  async call(method, params = {}) {
    this.requestId++;

    const payload = {
      jsonrpc: '2.0',
      method: method,
      params: params,
      id: this.requestId
    };

    return new Promise((resolve, reject) => {
      const data = JSON.stringify(payload);

      const options = {
        hostname: this.host,
        port: this.port,
        path: '/',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': data.length
        }
      };

      const req = http.request(options, (res) => {
        let responseData = '';

        res.on('data', (chunk) => {
          responseData += chunk;
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(responseData);

            if (result.error) {
              reject(new Error(`JSON-RPC Error ${result.error.code}: ${result.error.message}${result.error.data ? ' - ' + result.error.data : ''}`));
            } else {
              resolve(result.result);
            }
          } catch (err) {
            reject(err);
          }
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      req.write(data);
      req.end();
    });
  }

  /**
   * Check server health
   */
  async checkHealth() {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: this.host,
        port: this.port,
        path: '/health',
        method: 'GET'
      };

      const req = http.request(options, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          try {
            const result = JSON.parse(data);
            resolve(result.status === 'ok');
          } catch (err) {
            resolve(false);
          }
        });
      });

      req.on('error', () => {
        resolve(false);
      });

      req.setTimeout(5000, () => {
        req.destroy();
        resolve(false);
      });

      req.end();
    });
  }

  /**
   * Ping the server
   */
  async ping() {
    return this.call('ping');
  }

  /**
   * Initialize a CoLRev project
   */
  async initProject({
    projectId,
    reviewType = 'colrev.literature_review',
    example = false,
    forceMode = true,
    light = false,
    basePath = './projects'
  }) {
    return this.call('init_project', {
      project_id: projectId,
      review_type: reviewType,
      example: example,
      force_mode: forceMode,
      light: light,
      base_path: basePath
    });
  }

  /**
   * Get project status
   */
  async getStatus(projectId, basePath = './projects') {
    return this.call('get_status', {
      project_id: projectId,
      base_path: basePath
    });
  }
}

/**
 * CoLRev Server Manager for Electron
 */
class CoLRevServer {
  constructor(executablePath, host = '127.0.0.1', port = 8765) {
    this.executablePath = executablePath;
    this.host = host;
    this.port = port;
    this.process = null;
    this.client = new CoLRevClient(host, port);
  }

  /**
   * Start the JSON-RPC server
   */
  async start() {
    return new Promise((resolve, reject) => {
      // Start the server process
      this.process = spawn(this.executablePath, [
        '--host', this.host,
        '--port', this.port.toString()
      ]);

      // Handle stdout
      this.process.stdout.on('data', (data) => {
        console.log(`[CoLRev Server] ${data.toString().trim()}`);
      });

      // Handle stderr
      this.process.stderr.on('data', (data) => {
        console.error(`[CoLRev Server Error] ${data.toString().trim()}`);
      });

      // Handle process exit
      this.process.on('close', (code) => {
        console.log(`[CoLRev Server] Process exited with code ${code}`);
        this.process = null;
      });

      // Handle process error
      this.process.on('error', (err) => {
        reject(new Error(`Failed to start server: ${err.message}`));
      });

      // Wait for server to be ready
      this.waitForServer(10000)
        .then(() => resolve())
        .catch(reject);
    });
  }

  /**
   * Wait for server to be ready
   */
  async waitForServer(timeout = 10000) {
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      if (await this.client.checkHealth()) {
        console.log('[CoLRev Server] Server is ready');
        return true;
      }
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    throw new Error('Server failed to start within timeout');
  }

  /**
   * Stop the server
   */
  async stop() {
    if (this.process) {
      this.process.kill();
      this.process = null;
      console.log('[CoLRev Server] Server stopped');
    }
  }

  /**
   * Get the client instance
   */
  getClient() {
    return this.client;
  }
}

/**
 * Example usage in Electron main process
 */
async function exampleUsage() {
  // Path to the CoLRev JSON-RPC executable
  const executablePath = './dist/colrev-jsonrpc'; // Adjust path as needed

  // Create and start server
  const server = new CoLRevServer(executablePath, '127.0.0.1', 8765);

  try {
    console.log('Starting CoLRev server...');
    await server.start();

    // Get client
    const client = server.getClient();

    // Test ping
    console.log('Pinging server...');
    const pingResult = await client.ping();
    console.log('Ping result:', pingResult);

    // Initialize a project
    console.log('Initializing project...');
    const initResult = await client.initProject({
      projectId: 'my_electron_review',
      reviewType: 'colrev.literature_review',
      forceMode: true
    });
    console.log('Project initialized:', initResult);

    // Get project status
    console.log('Getting project status...');
    const statusResult = await client.getStatus('my_electron_review');
    console.log('Project status:', statusResult);

  } catch (error) {
    console.error('Error:', error);
  } finally {
    // Stop server when done (or on app quit)
    await server.stop();
  }
}

/**
 * Example Electron app.on('quit') handler
 */
function setupElectronHandlers(server) {
  const { app } = require('electron');

  // Stop server when app quits
  app.on('will-quit', async (event) => {
    event.preventDefault();
    await server.stop();
    app.exit();
  });
}

// Export classes for use in Electron
module.exports = {
  CoLRevClient,
  CoLRevServer,
  exampleUsage,
  setupElectronHandlers
};

// If running directly, execute example
if (require.main === module) {
  exampleUsage().catch(console.error);
}
