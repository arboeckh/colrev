import { RpcError, RPC_TRANSPORT_NOT_RUNNING, serializeRpcError } from './colrev-backend';
import type { ColrevBackend } from './colrev-backend';

/** The part of ColrevBackend the session uses; tests pass fakes. */
export type BackendLike = Pick<ColrevBackend, 'start' | 'stop' | 'call' | 'isRunning'>;

export interface BackendSessionDeps<B extends BackendLike> {
  /** Build a fresh backend (and wire its events). Called once per start. */
  create: () => B;
  isLockFreeMethod: (method: string) => boolean;
  withGitLock: <T>(label: string, fn: () => Promise<T>) => Promise<T>;
}

export type StartResult = { success: boolean; message?: string; error?: string };

/**
 * Owns the single ColrevBackend of the main process: when it is created,
 * replaced and dropped, and how RPCs reach it.
 *
 * Invariant: `current` is either null or a backend that is running (or being
 * restarted by its supervisor). A backend that was stopped is never kept
 * around, so "Already running" can never be answered for a dead process.
 */
export class BackendSession<B extends BackendLike = ColrevBackend> {
  private backend: B | null = null;
  private pendingStop: Promise<void> = Promise.resolve();

  constructor(private readonly deps: BackendSessionDeps<B>) {}

  get current(): B | null {
    return this.backend;
  }

  async start(): Promise<StartResult> {
    // A process that is still shutting down may hold the repos; do not start
    // a second one beside it.
    await this.pendingStop;

    if (this.backend?.isRunning) {
      return { success: true, message: 'Already running' };
    }
    if (this.backend) {
      // The object outlived its process (it gave up restarting, say).
      const dead = this.backend;
      this.backend = null;
      void dead.stop();
    }

    let backend: B | undefined;
    try {
      backend = this.deps.create();
      this.backend = backend;
      await backend.start();
      return { success: true };
    } catch (err) {
      if (this.backend === backend) this.backend = null;
      await backend?.stop();
      return { success: false, error: err instanceof Error ? err.message : 'Unknown error' };
    }
  }

  /** Stop the backend and forget it. Resolves once its process is gone. */
  stop(): Promise<void> {
    const backend = this.backend;
    this.backend = null;
    if (backend) {
      this.pendingStop = Promise.all([this.pendingStop, backend.stop()]).then(() => {});
    }
    return this.pendingStop;
  }

  /** The supervisor gave up on `backend`: drop it unless it was replaced. */
  discard(backend: B): void {
    if (this.backend === backend) this.backend = null;
  }

  /** Call the backend directly (no git lock). Rejects when there is none. */
  callBackend<T>(method: string, params: Record<string, unknown>): Promise<T> {
    if (!this.backend) return Promise.reject(new Error('Backend not running'));
    return this.backend.call<T>(method, params);
  }

  /**
   * Forward one RPC to the backend.
   *
   * Returns an envelope instead of throwing: Electron strips custom Error
   * properties at the IPC boundary, and the renderer needs the structured
   * {code, message, data, method} to branch on error codes.
   */
  async callRpc(
    method: string,
    params: Record<string, unknown>,
  ): Promise<{ ok: true; result: unknown } | { ok: false; error: ReturnType<typeof serializeRpcError> }> {
    const notRunning = () =>
      new RpcError('Backend not running', RPC_TRANSPORT_NOT_RUNNING, method);
    try {
      if (!this.backend) throw notRunning();
      const result = this.deps.isLockFreeMethod(method)
        ? await this.backend.call(method, params)
        : // Lock-retry lives in the Python dispatcher (see
          // colrev/ui_jsonrpc/framework/dispatcher.py); don't double-retry here.
          await this.deps.withGitLock(`rpc:${method}`, () => {
            // The backend may have been stopped or dropped while this call
            // waited for the lock.
            if (!this.backend) throw notRunning();
            return this.backend.call(method, params);
          });
      return { ok: true, result };
    } catch (err) {
      return { ok: false, error: serializeRpcError(err) };
    }
  }
}
