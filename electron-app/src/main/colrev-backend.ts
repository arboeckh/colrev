import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeout: NodeJS.Timeout;
}

/**
 * CoLRev JSON-RPC backend manager.
 * Spawns the colrev-jsonrpc subprocess and handles stdio communication.
 */
export class ColrevBackend extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, PendingRequest>();
  private rl: readline.Interface | null = null;

  constructor(
    private executablePath: string,
    private args: string[] = [],
    private env: Record<string, string> = {}
  ) {
    super();
  }

  /**
   * Start the backend subprocess.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Backend already running');
    }

    return new Promise((resolve, reject) => {
      // Merge environment with Git paths
      const processEnv = {
        ...process.env,
        ...this.env,
      };

      this.process = spawn(this.executablePath, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: processEnv,
      });

      // Handle spawn error
      this.process.on('error', (err) => {
        this.emit('error', err);
        reject(err);
      });

      // Parse stdout for JSON-RPC responses
      if (this.process.stdout) {
        this.rl = readline.createInterface({ input: this.process.stdout });
        this.rl.on('line', (line) => this.handleResponse(line));
      }

      // Forward stderr as logs
      this.process.stderr?.on('data', (data) => {
        const msg = data.toString().trim();
        this.emit('log', msg);
      });

      // Handle process exit
      this.process.on('close', (code) => {
        this.emit('close', code);
        this.cleanup();
      });

      // Retry ping until server is ready (more robust than parsing stderr)
      const startTimeout = setTimeout(() => {
        reject(new Error('Backend start timeout'));
        this.stop();
      }, 30000); // 30s for PyInstaller startup

      this.pingUntilReady(20, 500) // 20 retries, 500ms apart
        .then(() => {
          clearTimeout(startTimeout);
          resolve();
        })
        .catch((err) => {
          clearTimeout(startTimeout);
          reject(err);
        });
    });
  }

  /**
   * Retry ping until server responds.
   */
  private async pingUntilReady(retries: number, delayMs: number): Promise<void> {
    for (let i = 0; i < retries; i++) {
      try {
        await this.call('ping', {});
        return; // Success
      } catch {
        if (i < retries - 1) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw new Error('Server not responding to ping');
  }

  /**
   * Make a JSON-RPC call to the backend.
   */
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        return reject(new Error('Backend not running'));
      }

      const id = ++this.requestId;

      // Set timeout for this request
      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, 120000); // 2 minute timeout for long operations

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      const request = {
        jsonrpc: '2.0',
        method,
        params,
        id,
      };

      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
  }

  /**
   * Stop the backend subprocess.
   */
  stop(): void {
    if (this.process) {
      // Reject all pending requests
      for (const [id, pending] of this.pending) {
        clearTimeout(pending.timeout);
        pending.reject(new Error('Backend stopped'));
        this.pending.delete(id);
      }

      this.process.kill();
      this.cleanup();
    }
  }

  private handleResponse(line: string): void {
    try {
      const response = JSON.parse(line);
      const pending = this.pending.get(response.id);

      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(response.id);

        if (response.error) {
          pending.reject(
            new Error(`${response.error.code}: ${response.error.message}`)
          );
        } else {
          pending.resolve(response.result);
        }
      }
    } catch (err) {
      this.emit('error', new Error(`Failed to parse response: ${line}`));
    }
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.process = null;
  }
}
