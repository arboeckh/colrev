import { describe, it, expect, vi } from 'vitest';
import { BackendSession, type BackendLike } from './backend-session';
import { RpcError, RPC_TRANSPORT_NOT_RUNNING, RPC_TRANSPORT_TIMEOUT } from './colrev-backend';

class FakeBackend implements BackendLike {
  running = false;
  starts = 0;
  stops = 0;
  startError: Error | null = null;
  stopDelay: Promise<void> = Promise.resolve();
  call = vi.fn(async (method: string) => ({ method }) as never);
  whenTimedOutCallSettled = vi.fn(async () => {});

  get isRunning(): boolean {
    return this.running;
  }
  async start(): Promise<void> {
    this.starts++;
    if (this.startError) throw this.startError;
    this.running = true;
  }
  async stop(): Promise<void> {
    this.stops++;
    this.running = false;
    await this.stopDelay;
  }
}

function makeSession(
  opts: { lockFree?: (m: string) => boolean; startError?: Error } = {},
) {
  const created: FakeBackend[] = [];
  const lockOrder: string[] = [];
  let releaseLock: (() => void) | null = null;
  const session = new BackendSession<FakeBackend>({
    create: () => {
      const b = new FakeBackend();
      b.startError = opts.startError ?? null;
      created.push(b);
      return b;
    },
    isLockFreeMethod: opts.lockFree ?? (() => false),
    withGitLock: async (label, fn) => {
      lockOrder.push(label);
      // The lock is held by someone else until the test releases it.
      if (releaseLock === null && lockHeld) {
        await new Promise<void>((r) => (releaseLock = r));
      }
      return fn();
    },
  });
  let lockHeld = false;
  return {
    session,
    created,
    lockOrder,
    holdLock: () => (lockHeld = true),
    release: () => releaseLock?.(),
  };
}

describe('BackendSession', () => {
  it('starts a new backend after the window closed and reopened (stop, then start)', async () => {
    const { session, created } = makeSession();
    expect(await session.start()).toEqual({ success: true });

    // window-all-closed on macOS
    await session.stop();
    expect(session.current).toBeNull();

    // activate → colrev:start from the new window
    const result = await session.start();
    expect(result).toEqual({ success: true });
    expect(created).toHaveLength(2);
    expect(created[1].running).toBe(true);
    expect(await session.callRpc('project.ping', {})).toEqual({
      ok: true,
      result: { method: 'project.ping' },
    });
  });

  it('answers "Already running" only for a backend that is running', async () => {
    const { session, created } = makeSession();
    await session.start();
    expect(await session.start()).toEqual({ success: true, message: 'Already running' });
    expect(created).toHaveLength(1);

    // The object outlived its process.
    created[0].running = false;
    expect(await session.start()).toEqual({ success: true });
    expect(created).toHaveLength(2);
    expect(created[0].stops).toBe(1);
  });

  it('waits for a backend that is still shutting down before starting the next', async () => {
    const { session, created } = makeSession();
    await session.start();
    let finishStop!: () => void;
    created[0].stopDelay = new Promise<void>((r) => (finishStop = r));

    void session.stop();
    const starting = session.start();
    await new Promise((r) => setTimeout(r, 20));
    expect(created).toHaveLength(1);

    finishStop();
    expect(await starting).toEqual({ success: true });
    expect(created).toHaveLength(2);
  });

  it('drops a backend whose start failed', async () => {
    const { session, created } = makeSession({ startError: new Error('boom') });
    expect(await session.start()).toEqual({ success: false, error: 'boom' });
    expect(session.current).toBeNull();
    expect(created[0].stops).toBe(1);
  });

  it('discard() drops only the backend it was given', async () => {
    const { session, created } = makeSession();
    await session.start();
    await session.stop();
    await session.start();
    session.discard(created[0]); // stale event from the first backend
    expect(session.current).toBe(created[1]);
    session.discard(created[1]);
    expect(session.current).toBeNull();
  });

  it('rejects with -33003 and the real method name when the backend went away while waiting for the git lock', async () => {
    const h = makeSession();
    await h.session.start();
    h.holdLock();

    const pending = h.session.callRpc('records.update', {});
    await h.session.stop(); // colrev:stop / restart-failed while the call waits
    h.release();

    const outcome = await pending;
    expect(outcome).toMatchObject({
      ok: false,
      error: { code: RPC_TRANSPORT_NOT_RUNNING, method: 'records.update' },
    });
  });

  it('rejects with -33003 when there is no backend at all', async () => {
    const { session } = makeSession();
    expect(await session.callRpc('x', {})).toMatchObject({
      ok: false,
      error: { code: RPC_TRANSPORT_NOT_RUNNING, method: 'x' },
    });
  });

  it('skips the git lock for lock-free methods', async () => {
    const h = makeSession({ lockFree: (m) => m === 'ping' });
    await h.session.start();
    await h.session.callRpc('ping', {});
    await h.session.callRpc('write', {});
    expect(h.lockOrder).toEqual(['rpc:write']);
  });

  it('holds the git lock until a timed-out call has finished server-side', async () => {
    const events: string[] = [];
    let settle!: () => void;
    const settled = new Promise<void>((r) => (settle = r));
    let lockChain: Promise<unknown> = Promise.resolve();
    const session = new BackendSession<FakeBackend>({
      create: () => {
        const b = new FakeBackend();
        b.call.mockRejectedValue(
          new RpcError('Request timeout', RPC_TRANSPORT_TIMEOUT, 'get_git_status'),
        );
        b.whenTimedOutCallSettled.mockImplementation(() => settled);
        return b;
      },
      isLockFreeMethod: () => false,
      // A real FIFO lock: the second holder starts only after the first returns.
      withGitLock: (label, fn) => {
        const run = lockChain.then(async () => {
          events.push(`lock:${label}`);
          try {
            return await fn();
          } finally {
            events.push(`unlock:${label}`);
          }
        });
        lockChain = run.catch(() => {});
        return run;
      },
    });
    await session.start();

    const first = session.callRpc('get_git_status', {});
    const second = session.callRpc('other', {});
    await new Promise((r) => setTimeout(r, 20));
    // Python is still running the first call, so nothing may take the lock.
    expect(events).toEqual(['lock:rpc:get_git_status']);

    settle();
    expect(await first).toMatchObject({ ok: false, error: { code: RPC_TRANSPORT_TIMEOUT } });
    await second;
    expect(events.slice(0, 3)).toEqual([
      'lock:rpc:get_git_status',
      'unlock:rpc:get_git_status',
      'lock:rpc:other',
    ]);
  });

  it('does not wait for a backend failure that is not a timeout', async () => {
    const h = makeSession();
    await h.session.start();
    const backend = h.created[0];
    backend.call.mockRejectedValue(new Error('boom'));
    await h.session.callRpc('x', {});
    expect(backend.whenTimedOutCallSettled).not.toHaveBeenCalled();
  });
});
