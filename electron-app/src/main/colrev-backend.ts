import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import rpcSchemas from '../renderer/types/generated/rpc-schemas.json';

/**
 * Transport-level error codes. The Python server uses -320xx (JSON-RPC
 * standard + colrev domain codes, see colrev/ui_jsonrpc/error_handler.py);
 * these -330xx codes are produced only by this bridge, for failures the
 * server never got to answer.
 */
export const RPC_TRANSPORT_CRASHED = -33000;
export const RPC_TRANSPORT_TIMEOUT = -33001;
export const RPC_TRANSPORT_STOPPED = -33002;
export const RPC_TRANSPORT_NOT_RUNNING = -33003;
export const RPC_TRANSPORT_UNKNOWN = -33099;

/**
 * Typed RPC failure preserving the wire fields ({code, message, data}) plus
 * the method that failed. Renderer code branches on `code` — never on
 * message text.
 */
export class RpcError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly method: string,
    public readonly data?: unknown,
  ) {
    super(message);
    this.name = 'RpcError';
  }
}

/** The Python process died before answering. */
export class BackendCrashedError extends RpcError {
  constructor(method: string, exitCode: number | null) {
    super(
      `Backend process exited (code ${exitCode ?? 'unknown'}) before answering ${method}`,
      RPC_TRANSPORT_CRASHED,
      method,
    );
    this.name = 'BackendCrashedError';
  }
}

/** Wire shape used to carry an RpcError across the IPC boundary (Electron
 * strips custom Error properties, so `colrev:call` returns an envelope). */
export interface SerializedRpcError {
  code: number;
  message: string;
  method: string;
  data?: unknown;
}

export function serializeRpcError(err: unknown): SerializedRpcError {
  if (err instanceof RpcError) {
    return { code: err.code, message: err.message, method: err.method, data: err.data };
  }
  const message = err instanceof Error ? err.message : String(err);
  return { code: RPC_TRANSPORT_UNKNOWN, message, method: 'unknown' };
}

export interface RpcQueueState {
  /** Method currently being processed by the Python server (it is serial). */
  inFlight: { method: string; startedAt: number } | null;
  /** Methods waiting behind it, in send order. */
  queued: string[];
}

interface QueuedRequest {
  id: number;
  method: string;
  params: Record<string, unknown>;
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  /** null = no cap (slow methods rely on liveness + crash detection). */
  timeoutMs: number | null;
  timer: NodeJS.Timeout | null;
  /** Set when the timeout fired: the promise is already rejected, but the
   * request still occupies the serial pipe until its response arrives. */
  timedOut: boolean;
  /** Readiness probe (startup/restart ping) — the only kind of request the
   * pump may send before the server has answered its first ping. */
  probe: boolean;
  sentAt: number | null;
}

const BACKEND_LOG_CAP_BYTES = 10 * 1024 * 1024;
const BACKEND_LOG_TRUNCATE_TO_BYTES = 5 * 1024 * 1024;

const FAST_TIMEOUT_MS = 10_000;
const RESTART_DELAYS_MS = [500, 1000, 2000];
const START_TIMEOUT_MS = 60_000;

type TimeoutClass = 'fast' | 'slow';

/** Per-method timeout classes from the generated schema — the same document
 * the renderer types come from, so there is no second hand-maintained list. */
const SCHEMA_TIMEOUT_CLASSES: Record<string, TimeoutClass> = Object.fromEntries(
  Object.entries(
    rpcSchemas.methods as Record<string, { timeout_class?: string }>,
  ).map(([name, spec]) => [name, spec.timeout_class === 'fast' ? 'fast' : 'slow']),
);

export interface ColrevBackendOptions {
  /** Test seam: override the schema-derived timeout classes. */
  timeoutClasses?: Record<string, TimeoutClass>;
  fastTimeoutMs?: number;
  restartDelaysMs?: number[];
  startTimeoutMs?: number;
}

/**
 * CoLRev JSON-RPC backend manager.
 *
 * Spawns the colrev-jsonrpc subprocess and handles stdio communication.
 * The Python server is a strict FIFO of one (see docs/adr/0001): this class
 * owns the matching queue on the JS side so that ordering is observable —
 * `rpc-queue` events expose what is in flight and what is waiting.
 *
 * Lifecycle: an unexpected process exit rejects every pending request with
 * BackendCrashedError, then attempts a supervised restart with capped
 * backoff ('restarting'/'restarted'/'restart-failed' events). Requests
 * queued during the restart window are sent once the new process is ready.
 */
export class ColrevBackend extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private queue: QueuedRequest[] = [];
  private inFlight: QueuedRequest | null = null;
  private rl: readline.Interface | null = null;
  private stopping = false;
  private supervising = false;
  /** True once the backend has answered a ping. Crashes before readiness are
   * startup failures (reported to the caller of start()), not supervised. */
  private everReady = false;
  /** True while the *current* process has answered a ping. While false, the
   * pump only sends readiness probes so user requests can't wedge the
   * startup/restart handshake behind a slow call. */
  private ready = false;
  private readonly tracePath: string | null;
  private readonly backendLogPath: string | null;
  private readonly timeoutClasses: Record<string, TimeoutClass>;
  private readonly fastTimeoutMs: number;
  private readonly restartDelaysMs: number[];
  private readonly startTimeoutMs: number;

  constructor(
    private executablePath: string,
    private args: string[] = [],
    private env: Record<string, string> = {},
    opts: ColrevBackendOptions = {},
  ) {
    super();

    this.timeoutClasses = opts.timeoutClasses ?? SCHEMA_TIMEOUT_CLASSES;
    this.fastTimeoutMs = opts.fastTimeoutMs ?? FAST_TIMEOUT_MS;
    this.restartDelaysMs = opts.restartDelaysMs ?? RESTART_DELAYS_MS;
    this.startTimeoutMs = opts.startTimeoutMs ?? START_TIMEOUT_MS;

    const registryPath = process.env.COLREV_FAKE_GITHUB_REGISTRY;
    if (registryPath) {
      const traceDir = path.dirname(registryPath);
      this.tracePath = path.join(traceDir, 'rpc.jsonl');
      this.backendLogPath = path.join(traceDir, 'backend.log');
    } else {
      this.tracePath = null;
      this.backendLogPath = null;
    }
  }

  private appendTrace(entry: Record<string, unknown>): void {
    if (!this.tracePath) return;
    try {
      fs.appendFileSync(this.tracePath, JSON.stringify(entry) + '\n');
    } catch {
      // tracing must not break the bridge
    }
  }

  private appendBackendLog(chunk: string): void {
    if (!this.backendLogPath) return;
    try {
      fs.appendFileSync(this.backendLogPath, chunk);
      const size = fs.statSync(this.backendLogPath).size;
      if (size > BACKEND_LOG_CAP_BYTES) {
        const fd = fs.openSync(this.backendLogPath, 'r');
        const buf = Buffer.alloc(BACKEND_LOG_TRUNCATE_TO_BYTES);
        fs.readSync(fd, buf, 0, BACKEND_LOG_TRUNCATE_TO_BYTES, size - BACKEND_LOG_TRUNCATE_TO_BYTES);
        fs.closeSync(fd);
        fs.writeFileSync(this.backendLogPath, buf);
      }
    } catch {
      // tracing must not break the bridge
    }
  }

  /**
   * Start the backend subprocess and wait until it answers a ping.
   */
  async start(): Promise<void> {
    if (this.process) {
      throw new Error('Backend already running');
    }
    this.stopping = false;
    // A fresh manual start owns its own failure reporting — a crash before
    // this start reaches readiness must not trigger supervision.
    this.everReady = false;
    await this.spawnAndWaitReady();
  }

  /** Spawn the child and wait for a successful ping (or throw). */
  private spawnAndWaitReady(): Promise<void> {
    return new Promise((resolve, reject) => {
      const processEnv = {
        ...process.env,
        ...this.env,
      };

      this.process = spawn(this.executablePath, this.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: processEnv,
      });

      // Handle spawn error (e.g. executable missing)
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
        const raw = data.toString();
        this.appendBackendLog(raw);
        const msg = raw.trim();
        this.emit('log', msg);
      });

      // Handle process exit
      this.process.on('close', (code) => this.handleClose(code));

      // Retry ping until server is ready. Cold start of the packaged
      // python-build-standalone bundle takes the time of a Python interpreter
      // boot plus colrev imports — budget generously the first time macOS
      // loads it. The renderer shows a splash overlay in the meantime.
      const startTimeout = setTimeout(() => {
        reject(new Error('Backend start timeout'));
        // Kill without setting `stopping` — a supervised restart must be able
        // to try again after a failed attempt.
        this.killProcess();
      }, this.startTimeoutMs);

      this.pingUntilReady(this.startTimeoutMs)
        .then(() => {
          clearTimeout(startTimeout);
          this.everReady = true;
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
   * doesn't prevent the next retry. Probes jump the queue (priority) so
   * requests queued during a restart window can't starve the readiness check.
   */
  private async pingUntilReady(deadlineMs: number): Promise<void> {
    const PING_TIMEOUT_MS = 1000;
    const PING_INTERVAL_MS = 500;
    const start = Date.now();

    while (Date.now() - start < deadlineMs) {
      if (this.stopping || !this.process) {
        throw new Error('Backend stopped during startup');
      }
      try {
        await this.enqueue('ping', {}, { timeoutMs: PING_TIMEOUT_MS, probe: true });
        this.ready = true;
        // Drain anything queued while the handshake was in progress.
        this.pump();
        this.emitQueueState();
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
   * Make a JSON-RPC call to the backend.
   *
   * Timeout policy comes from the method's `timeout_class` in the generated
   * schema: "fast" methods are capped (~10s of server processing after the
   * request is sent — time spent queued does not count and is observable via
   * `rpc-queue` events instead); "slow" methods have no cap, so a long
   * operation can never end in "timed out in the UI but committed on disk".
   * Liveness for slow methods comes from progress events and crash detection.
   */
  call<T = unknown>(method: string, params: Record<string, unknown>): Promise<T> {
    const timeoutMs =
      this.timeoutClasses[method] === 'fast' ? this.fastTimeoutMs : null;
    return this.enqueue(method, params, { timeoutMs }) as Promise<T>;
  }

  private enqueue(
    method: string,
    params: Record<string, unknown>,
    opts: { timeoutMs: number | null; probe?: boolean },
  ): Promise<unknown> {
    return new Promise((resolve, reject) => {
      // Accept while a process exists or a supervised restart is underway
      // (queued requests are sent once the new process answers ping).
      if (!this.process && !this.supervising) {
        return reject(
          new RpcError('Backend not running', RPC_TRANSPORT_NOT_RUNNING, method),
        );
      }

      const entry: QueuedRequest = {
        id: ++this.requestId,
        method,
        params,
        resolve,
        reject,
        timeoutMs: opts.timeoutMs,
        timer: null,
        timedOut: false,
        probe: opts.probe ?? false,
        sentAt: null,
      };

      if (entry.probe) {
        // Probes jump the queue so a restart handshake can't starve behind
        // requests queued during the outage.
        this.queue.unshift(entry);
      } else {
        this.queue.push(entry);
      }
      this.pump();
      this.emitQueueState();
    });
  }

  /** Send the next queued request if the pipe is idle. Strictly one in
   * flight: the Python server is serial, and holding back until the previous
   * response arrives is what makes `inFlight` truthful. */
  private pump(): void {
    if (this.inFlight || !this.process?.stdin || this.queue.length === 0) {
      return;
    }
    if (!this.ready && !this.queue[0].probe) {
      return;
    }

    const entry = this.queue.shift()!;
    this.inFlight = entry;
    entry.sentAt = Date.now();

    if (entry.timeoutMs !== null) {
      entry.timer = setTimeout(() => this.handleTimeout(entry), entry.timeoutMs);
    }

    const request = { jsonrpc: '2.0', method: entry.method, params: entry.params, id: entry.id };
    this.appendTrace({
      ts: new Date().toISOString(),
      type: 'request',
      id: entry.id,
      method: entry.method,
      params: entry.params,
    });
    this.process.stdin.write(JSON.stringify(request) + '\n');
  }

  private handleTimeout(entry: QueuedRequest): void {
    if (this.inFlight !== entry) return;
    // The request stays in flight (the serial pipe is still occupied
    // server-side); the caller is released now, and the eventual response is
    // reconciled in handleResponse rather than silently dropped.
    entry.timedOut = true;
    entry.reject(
      new RpcError(
        `Request timeout after ${entry.timeoutMs}ms: ${entry.method} (still running server-side)`,
        RPC_TRANSPORT_TIMEOUT,
        entry.method,
      ),
    );
    this.appendTrace({
      ts: new Date().toISOString(),
      type: 'timeout',
      id: entry.id,
      method: entry.method,
      timeoutMs: entry.timeoutMs,
    });
  }

  /**
   * Stop the backend subprocess deliberately (no restart).
   */
  stop(): void {
    this.stopping = true;
    // Reject even with no live process — requests may be queued while a
    // supervised restart is underway.
    this.rejectAllPending(
      (method) => new RpcError('Backend stopped', RPC_TRANSPORT_STOPPED, method),
    );
    this.killProcess();
  }

  private killProcess(): void {
    if (this.process) {
      this.process.kill();
      this.cleanup();
    }
  }

  /** Current queue snapshot (also pushed via 'rpc-queue' events). */
  getQueueState(): RpcQueueState {
    return {
      inFlight: this.inFlight
        ? { method: this.inFlight.method, startedAt: this.inFlight.sentAt ?? 0 }
        : null,
      queued: this.queue.map((e) => e.method),
    };
  }

  private emitQueueState(): void {
    this.emit('rpc-queue', this.getQueueState());
  }

  private rejectAllPending(makeError: (method: string) => Error): void {
    const entries = [...(this.inFlight ? [this.inFlight] : []), ...this.queue];
    this.inFlight = null;
    this.queue = [];
    for (const entry of entries) {
      if (entry.timer) clearTimeout(entry.timer);
      if (!entry.timedOut) {
        entry.reject(makeError(entry.method));
      }
    }
    this.emitQueueState();
  }

  private handleClose(code: number | null): void {
    this.emit('close', code);
    // Reject promptly — callers must not wait out a timeout that will never
    // be answered.
    this.rejectAllPending((method) => new BackendCrashedError(method, code));
    this.cleanup();

    if (!this.stopping && !this.supervising && this.everReady) {
      void this.superviseRestart();
    }
  }

  /**
   * Restart after an unexpected exit, with capped exponential backoff.
   * Emits 'restarting' {attempt, maxAttempts, delayMs} per attempt, then
   * 'restarted' on success or 'restart-failed' when giving up.
   */
  private async superviseRestart(): Promise<void> {
    this.supervising = true;
    try {
      for (let attempt = 1; attempt <= this.restartDelaysMs.length; attempt++) {
        const delayMs = this.restartDelaysMs[attempt - 1];
        this.emit('restarting', {
          attempt,
          maxAttempts: this.restartDelaysMs.length,
          delayMs,
        });
        await new Promise((r) => setTimeout(r, delayMs));
        if (this.stopping) return;
        try {
          await this.spawnAndWaitReady();
          this.emit('restarted');
          // Requests queued while supervising are now sent.
          this.pump();
          this.emitQueueState();
          return;
        } catch (err) {
          this.emit(
            'log',
            `[supervisor] restart attempt ${attempt} failed: ${err instanceof Error ? err.message : err}`,
          );
          // A half-started process may linger (e.g. spawned but not
          // answering); kill it before the next attempt.
          this.killProcess();
        }
      }
      this.rejectAllPending(
        (method) => new RpcError('Backend restart failed', RPC_TRANSPORT_CRASHED, method),
      );
      this.emit('restart-failed');
    } finally {
      this.supervising = false;
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
          this.appendTrace({
            ts: new Date().toISOString(),
            type: 'progress',
            params: message.params,
          });
          this.emit('progress', message.params);
        } else {
          // Unknown notification kind — forward as a log so it's observable.
          this.emit('log', `[notification:${message.method}] ${trimmed}`);
        }
        return;
      }

      const entry = this.inFlight;
      if (!entry || message.id !== entry.id) {
        // A response we no longer have a caller for (e.g. arrived after a
        // crash-rejection raced the actual response). Log, don't crash.
        this.emit('log', `[orphan-response] ${trimmed}`);
        return;
      }

      if (entry.timer) clearTimeout(entry.timer);
      this.inFlight = null;

      const durationMs = Date.now() - (entry.sentAt ?? Date.now());
      const traceBase = {
        ts: new Date().toISOString(),
        type: entry.timedOut ? 'late-response' : 'response',
        id: entry.id,
        method: entry.method,
        durationMs,
      };

      if (entry.timedOut) {
        // The caller was already released by the timeout. Surface the late
        // outcome so upstream state can reconcile instead of dropping it.
        this.appendTrace({ ...traceBase, error: message.error, result: message.result });
        this.emit('late-response', {
          method: entry.method,
          id: entry.id,
          durationMs,
          ok: !message.error,
        });
      } else if (message.error) {
        this.appendTrace({ ...traceBase, error: message.error });
        entry.reject(
          new RpcError(
            message.error.message ?? 'RPC error',
            typeof message.error.code === 'number' ? message.error.code : -32603,
            entry.method,
            message.error.data,
          ),
        );
      } else {
        this.appendTrace({ ...traceBase, result: message.result });
        entry.resolve(message.result);
      }

      this.pump();
      this.emitQueueState();
    } catch {
      // Non-JSON output from Python subprocess (e.g., library debug messages)
      this.emit('log', `[python-stdout] ${trimmed}`);
    }
  }

  private cleanup(): void {
    this.rl?.close();
    this.rl = null;
    this.process = null;
    this.ready = false;
  }
}
