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

      // Retry ping until server is ready. Cold start of the packaged
      // python-build-standalone bundle takes the time of a Python interpreter
      // boot plus colrev imports — budget generously the first time macOS
      // loads it. The renderer shows a splash overlay in the meantime.
      const START_TIMEOUT_MS = 60_000;
      const startTimeout = setTimeout(() => {
        reject(new Error('Backend start timeout'));
        this.stop();
      }, START_TIMEOUT_MS);

      this.pingUntilReady(START_TIMEOUT_MS)
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
   * Ping the server periodically until it responds or the deadline passes.
   *
   * Each attempt uses a short per-call timeout (~1s) so a stalled request
   * doesn't prevent the next retry — the previous implementation reused the
   * default 120s request timeout, which meant the first ping just blocked on
   * the pipe forever and the "retry" loop never actually fired.
   */
  private async pingUntilReady(deadlineMs: number): Promise<void> {
    const PING_TIMEOUT_MS = 1000;
    const PING_INTERVAL_MS = 500;
    const start = Date.now();

    while (Date.now() - start < deadlineMs) {
      try {
        await this.callWithTimeout('ping', {}, PING_TIMEOUT_MS);
        return;
      } catch {
        // Swallow ping failures during startup; emit a log so the renderer
        // can show elapsed-time reassurance in the splash overlay.
        const elapsed = Math.round((Date.now() - start) / 1000);
        this.emit('log', `[startup] waiting for backend (${elapsed}s)`);
        await new Promise((r) => setTimeout(r, PING_INTERVAL_MS));
      }
    }
    throw new Error('Server not responding to ping');
  }

  /**
   * Make a JSON-RPC call with a caller-supplied timeout (in ms) instead of
   * the default 2-minute request timeout. Used for startup probes where
   * long timeouts defeat the retry logic.
   */
  private callWithTimeout<T = unknown>(
    method: string,
    params: Record<string, unknown>,
    timeoutMs: number,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        return reject(new Error('Backend not running'));
      }

      const id = ++this.requestId;

      const timeout = setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`Request timeout: ${method}`));
        }
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timeout,
      });

      const request = { jsonrpc: '2.0', method, params, id };
      this.process.stdin.write(JSON.stringify(request) + '\n');
    });
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
    const trimmed = line.trim();
    if (!trimmed) return;

    try {
      const message = JSON.parse(trimmed);

      // JSON-RPC notification (no `id`): progress events or other server-push.
      // Responses always have an `id`; notifications have `method` + `params`.
      if (message.id === undefined && typeof message.method === 'string') {
        if (message.method === 'progress') {
          this.emit('progress', message.params);
        } else {
          // Unknown notification kind — forward as a log so it's observable.
          this.emit('log', `[notification:${message.method}] ${trimmed}`);
        }
        return;
      }

      const pending = this.pending.get(message.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pending.delete(message.id);

        if (message.error) {
          pending.reject(
            new Error(`${message.error.code}: ${message.error.message}`)
          );
        } else {
          pending.resolve(message.result);
        }
      }
    } catch (err) {
      // Non-JSON output from Python subprocess (e.g., library debug messages)
      this.emit('log', `[python-stdout] ${trimmed}`);
    }
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.process = null;
  }
}
