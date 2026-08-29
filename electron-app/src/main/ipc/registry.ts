import { ipcMain } from 'electron';
import { withGitLock, withLockRetry } from '../gitMutex';

/**
 * IPC handler registration with a lock-by-default policy.
 *
 * Every handler runs inside the shared git mutex (see `gitMutex.ts`) unless it
 * explicitly opts out. Opting out requires a reason — `defineHandler` throws
 * without one — so an exemption can't be added by forgetting to think about it,
 * which is how `get_git_status` ended up on the "git-free" list while
 * constructing a `git.Repo` and reading the index.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type HandlerArgs = any[];

export type IpcHandler = (
  event: Electron.IpcMainInvokeEvent,
  ...args: HandlerArgs
) => Promise<unknown>;

export interface IpcHandlerSpec {
  channel: string;
  handler: IpcHandler;
  /** True only for handlers that provably never touch the repo. */
  lockFree: boolean;
  /** Why the exemption is safe. Required whenever `lockFree` is true. */
  lockFreeReason?: string;
}

export interface DefineHandlerOptions {
  channel: string;
  handler: IpcHandler;
  /**
   * Skip the git mutex. Pass together with `lockFreeReason` explaining why the
   * handler cannot contend for `.git/index.lock` — "it's only a read" is not a
   * reason: reads of mutable state still need serializing against writers.
   */
  lockFree?: boolean;
  lockFreeReason?: string;
}

export function defineHandler(options: DefineHandlerOptions): IpcHandlerSpec {
  const lockFree = options.lockFree ?? false;
  if (lockFree && !options.lockFreeReason?.trim()) {
    throw new Error(
      `IPC handler "${options.channel}" is marked lockFree without a lockFreeReason`,
    );
  }
  return {
    channel: options.channel,
    handler: options.handler,
    lockFree,
    lockFreeReason: options.lockFreeReason,
  };
}

export type RegisterFn = (channel: string, handler: IpcHandler) => void;

/**
 * Bind specs to `ipcMain`, wrapping locked handlers in the mutex plus the
 * transparent `.git/index.lock` retry.
 */
export function registerHandlers(
  specs: IpcHandlerSpec[],
  register: RegisterFn = (channel, handler) => ipcMain.handle(channel, handler),
): void {
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.channel)) {
      throw new Error(`Duplicate IPC handler registration for "${spec.channel}"`);
    }
    seen.add(spec.channel);

    if (spec.lockFree) {
      register(spec.channel, spec.handler);
      continue;
    }
    register(spec.channel, async (event, ...args) =>
      withLockRetry(spec.channel, () =>
        withGitLock(spec.channel, () => spec.handler(event, ...args)),
      ),
    );
  }
}

/**
 * JSON-RPC methods exempt from the JS-side git mutex — and ONLY from that.
 *
 * This is not a fast lane: the Python server is strictly serial (one request at
 * a time — see docs/adr/0001-serial-python-rpc-backend.md), so every RPC still
 * queues inside `ColrevBackend`'s FIFO. The exemption only means these methods
 * don't additionally wait for the mutex shared with the dugite handlers.
 *
 * The bar is "opens no repository at all". `get_git_status` deliberately does
 * NOT qualify: it constructs a `git.Repo` and reads the index and refs, which
 * is exactly the state a concurrent write is mutating.
 */
export const LOCK_FREE_RPC_METHODS: ReadonlyMap<string, string> = new Map([
  ['ping', 'transport liveness check; touches no filesystem'],
  ['init_project', 'creates the repo directory before any repo exists'],
  ['list_projects', 'reads the project registry file, never a repo'],
  ['delete_project', 'removes a directory tree; nothing else may be using it'],
  ['get_csv_source_templates', 'reads bundled static templates'],
]);

export function isLockFreeRpcMethod(method: string): boolean {
  return LOCK_FREE_RPC_METHODS.has(method);
}
