/**
 * The one preload-bridge double used by renderer unit tests (WP-08 §1).
 *
 * Everything the renderer can reach outside itself goes through `window.*`
 * (see `types/window.d.ts`, implemented by `src/preload/index.ts`). This
 * module installs a typed stand-in for that surface so stores and components
 * are testable headlessly instead of only through Playwright.
 *
 * Two properties are load-bearing:
 *
 * 1. **Typed against the generated schema.** `rpc.on(...)` is keyed by
 *    `RPCMethodName` and its implementation returns `RPCResult<M>` — so a
 *    backend model change that regenerates `types/generated/rpc.d.ts` breaks
 *    these tests at `vue-tsc` time. That is the point: the mock is not free
 *    to drift from the contract.
 * 2. **No implicit success.** An RPC the test did not stub answers
 *    `METHOD_NOT_FOUND` rather than `undefined`, so a store quietly calling a
 *    method the test did not anticipate fails loudly.
 */
import { vi, type MockedObject } from 'vitest';
import { RPC_ERROR_CODES, type RpcCallEnvelope, type SerializedRpcError } from '@/lib/rpc-errors';
import type {
  ProgressEvent,
  RPCMethodName,
  RPCParams,
  RPCResult,
} from '@/types/generated/rpc';
import type {
  AccountInfo,
  AppInfoAPI,
  AuthAPI,
  AuthSession,
  ColrevAPI,
  DeviceFlowStatus,
  FileOpsAPI,
  GitAPI,
  GitHubAPI,
  GitStateAPI,
  GitStateSnapshot,
  PdfFilesAPI,
  RestartingInfo,
  RpcQueueState,
} from '@/types/window';

// --- helpers ---------------------------------------------------------------

type Listener<T> = (value: T) => void;

/** A subscribe/emit pair mirroring the preload's `on*` callback bridges. */
function channel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    subscribe(fn: Listener<T>): () => void {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    emit(value: T): void {
      for (const fn of Array.from(listeners)) fn(value);
    },
    get size(): number {
      return listeners.size;
    },
  };
}

/**
 * Thrown by an RPC stub to answer with a structured failure envelope (the
 * shape `main` sends for a backend error), as opposed to the bridge itself
 * rejecting.
 */
class StubbedRpcFailure extends Error {
  constructor(public readonly payload: SerializedRpcError) {
    super(payload.message);
    this.name = 'StubbedRpcFailure';
  }
}

export interface RecordedRpcCall {
  method: string;
  params: Record<string, unknown>;
}

// --- RPC ------------------------------------------------------------------

export class MockRpc {
  private readonly handlers = new Map<string, (params: never) => unknown>();

  /** Every call that reached the bridge, in order, with resolved params. */
  readonly calls: RecordedRpcCall[] = [];

  /** Stub a method's happy path. Params and result are contract-typed. */
  on<M extends RPCMethodName>(
    method: M,
    impl: RPCResult<M> | ((params: RPCParams<M>) => RPCResult<M> | Promise<RPCResult<M>>),
  ): this {
    this.handlers.set(
      method,
      typeof impl === 'function'
        ? (impl as (params: never) => unknown)
        : () => impl,
    );
    return this;
  }

  /** Stub a method to answer with a structured RPC error envelope. */
  onError<M extends RPCMethodName>(
    method: M,
    error: { code?: number; message?: string; data?: unknown } = {},
  ): this {
    this.handlers.set(method, () => {
      throw new StubbedRpcFailure({
        code: error.code ?? RPC_ERROR_CODES.OPERATION_ERROR,
        message: error.message ?? `stubbed failure for ${method}`,
        method,
        data: error.data,
      });
    });
    return this;
  }

  /** Stub a method so the bridge promise itself rejects (IPC-level failure). */
  onReject<M extends RPCMethodName>(method: M, error: Error): this {
    this.handlers.set(method, () => {
      throw error;
    });
    return this;
  }

  /** Calls recorded for one method, in order. */
  callsTo(method: RPCMethodName): RecordedRpcCall[] {
    return this.calls.filter((c) => c.method === method);
  }

  countOf(method: RPCMethodName): number {
    return this.callsTo(method).length;
  }

  clearCalls(): void {
    this.calls.length = 0;
  }

  /** The bridge function handed to `window.colrev.call`. */
  async dispatch(
    method: string,
    params: Record<string, unknown>,
  ): Promise<RpcCallEnvelope<unknown>> {
    this.calls.push({ method, params });
    const handler = this.handlers.get(method);
    if (!handler) {
      return {
        ok: false,
        error: {
          code: RPC_ERROR_CODES.METHOD_NOT_FOUND,
          message: `window-mock: no stub registered for '${method}'`,
          method,
        },
      };
    }
    try {
      return { ok: true, result: await (handler as (p: unknown) => unknown)(params) };
    } catch (err) {
      if (err instanceof StubbedRpcFailure) return { ok: false, error: err.payload };
      throw err;
    }
  }
}

// --- git snapshots ---------------------------------------------------------

/** A fully-populated snapshot; override only the fields a test cares about. */
export function makeGitSnapshot(
  overrides: Partial<GitStateSnapshot> & { projectId: string },
): GitStateSnapshot {
  return {
    branch: 'dev',
    ahead: 0,
    behind: 0,
    mainAhead: 0,
    mainBehind: 0,
    isClean: true,
    remoteUrl: 'https://github.com/acme/lit-review.git',
    hasMergeConflict: false,
    uncommittedChanges: 0,
    modifiedFiles: [],
    stagedFiles: [],
    untrackedFiles: [],
    stagedRecordChanges: [],
    lastCommit: null,
    refreshedAt: 1,
    ...overrides,
  };
}

// --- the installed mock ----------------------------------------------------

export interface WindowMock {
  rpc: MockRpc;
  // Exposed as mocks, not plain interfaces, so a test can reach for
  // `.mockResolvedValue(...)` on any bridge call it wants to steer.
  colrev: MockedObject<ColrevAPI>;
  fileOps: MockedObject<FileOpsAPI>;
  pdfFiles: MockedObject<PdfFilesAPI>;
  appInfo: MockedObject<AppInfoAPI>;
  auth: MockedObject<AuthAPI>;
  gitState: MockedObject<GitStateAPI>;
  github: MockedObject<GitHubAPI>;
  git: MockedObject<GitAPI>;

  /** Snapshots `gitState.refresh` / `gitState.get` answer with, by project. */
  snapshots: Map<string, GitStateSnapshot>;
  /** When set, the next `gitState.refresh` reports this failure. */
  gitStateRefreshError: string | null;

  /** Set a snapshot AND push it down the `onChanged` channel, as main does. */
  pushGitSnapshot(snapshot: GitStateSnapshot): void;
  /** Set a snapshot without notifying subscribers (tests the pull path). */
  setGitSnapshot(snapshot: GitStateSnapshot): void;

  emitLog(msg: string): void;
  emitError(msg: string): void;
  emitClose(code: number | null): void;
  emitProgress(event: ProgressEvent): void;
  emitRestarting(info: RestartingInfo): void;
  emitRestarted(): void;
  emitRestartFailed(): void;
  emitRpcQueue(state: RpcQueueState): void;
  emitAuthUpdate(session: AuthSession | null): void;
  emitDeviceFlowStatus(status: DeviceFlowStatus): void;

  /** Number of live `gitState.onChanged` subscribers. */
  gitStateSubscriberCount(): number;
}

function okResult() {
  return { success: true as const };
}

export function createWindowMock(): WindowMock {
  const rpc = new MockRpc();

  const logs = channel<string>();
  const errors = channel<string>();
  const closes = channel<number | null>();
  const progress = channel<ProgressEvent>();
  const restarting = channel<RestartingInfo>();
  const restarted = channel<void>();
  const restartFailed = channel<void>();
  const rpcQueue = channel<RpcQueueState>();
  const gitStateChanged = channel<GitStateSnapshot>();
  const authUpdates = channel<AuthSession | null>();
  const deviceFlow = channel<DeviceFlowStatus>();

  const snapshots = new Map<string, GitStateSnapshot>();

  const colrev = {
    start: vi.fn(async () => okResult()),
    stop: vi.fn(async () => okResult()),
    call: vi.fn(((method: string, params: Record<string, unknown>) =>
      rpc.dispatch(method, params)) as ColrevAPI['call']),
    onLog: vi.fn(logs.subscribe),
    onError: vi.fn(errors.subscribe),
    onClose: vi.fn(closes.subscribe),
    onProgress: vi.fn(progress.subscribe),
    onRestarting: vi.fn(restarting.subscribe),
    onRestarted: vi.fn((cb: () => void) => restarted.subscribe(cb)),
    onRestartFailed: vi.fn((cb: () => void) => restartFailed.subscribe(cb)),
    onRpcQueue: vi.fn(rpcQueue.subscribe),
  } as unknown as MockedObject<ColrevAPI>;

  const fileOps = {
    saveDialog: vi.fn(async () => ({ success: true, filePath: '/tmp/out.csv' })),
    chooseSavePath: vi.fn(async () => ({ success: true, filePath: '/tmp/out.csv' })),
    openDialog: vi.fn(async () => ({ success: true, filePath: '/tmp/in.ris' })),
  } as unknown as MockedObject<FileOpsAPI>;

  const pdfFiles = {
    exists: vi.fn(async () => ({ exists: true })),
  } as unknown as MockedObject<PdfFilesAPI>;

  const appInfo = {
    get: vi.fn(async () => ({
      isPackaged: false,
      resourcesPath: '/app/resources',
      appPath: '/app',
      version: '0.1.0-test',
      projectsPath: '/projects',
    })),
  } as unknown as MockedObject<AppInfoAPI>;

  const auth = {
    getSession: vi.fn(async () => null),
    getCachedSession: vi.fn(async () => null),
    login: vi.fn(async () => {}),
    logout: vi.fn(async () => {}),
    getToken: vi.fn(async () => null),
    listAccounts: vi.fn(async () => [] as AccountInfo[]),
    switchAccount: vi.fn(async () => null),
    removeAccount: vi.fn(async () => okResult()),
    onAuthUpdate: vi.fn(authUpdates.subscribe),
    onDeviceFlowStatus: vi.fn(deviceFlow.subscribe),
  } as unknown as MockedObject<AuthAPI>;

  const mock: WindowMock = {
    rpc,
    colrev,
    fileOps,
    pdfFiles,
    appInfo,
    auth,
    snapshots,
    gitStateRefreshError: null,

    gitState: {
      refresh: vi.fn(async (projectId: string) => {
        if (mock.gitStateRefreshError) {
          return {
            success: false,
            error: mock.gitStateRefreshError,
            state: snapshots.get(projectId) ?? null,
          };
        }
        return { success: true, state: snapshots.get(projectId) ?? null };
      }),
      get: vi.fn(async (projectId: string) => snapshots.get(projectId) ?? null),
      onChanged: vi.fn(gitStateChanged.subscribe),
    } as unknown as MockedObject<GitStateAPI>,

    github: {
      createRepoAndPush: vi.fn(async () => okResult()),
      listColrevRepos: vi.fn(async () => ({ success: true, repos: [] })),
      cloneRepo: vi.fn(async () => okResult()),
      listReleases: vi.fn(async () => ({ success: true, releases: [] })),
      listCollaborators: vi.fn(async () => ({ success: true, collaborators: [] })),
      addCollaborator: vi.fn(async () => ({ success: true, invited: true })),
      inviteUserSuggestions: vi.fn(async () => ({ success: true, suggestions: [] })),
      listPendingInvitations: vi.fn(async () => ({ success: true, invitations: [] })),
      listInvitations: vi.fn(async () => ({ success: true, invitations: [] })),
      acceptInvitation: vi.fn(async () => okResult()),
      declineInvitation: vi.fn(async () => okResult()),
      createRelease: vi.fn(async () => okResult()),
      deleteRepo: vi.fn(async () => okResult()),
    } as unknown as MockedObject<GitHubAPI>,

    git: {
      fetch: vi.fn(async () => okResult()),
      pull: vi.fn(async () => okResult()),
      fastForwardMain: vi.fn(async () => okResult()),
      push: vi.fn(async () => okResult()),
      pushBranch: vi.fn(async () => okResult()),
      listBranches: vi.fn(async () => ({ success: true, branches: [], currentBranch: 'dev' })),
      createBranch: vi.fn(async () => okResult()),
      createLocalBranch: vi.fn(async () => okResult()),
      deleteLocalBranch: vi.fn(async () => okResult()),
      deleteRemoteBranch: vi.fn(async () => okResult()),
      checkout: vi.fn(async () => okResult()),
      merge: vi.fn(async () => okResult()),
      log: vi.fn(async () => ({ success: true, commits: [] })),
      dirtyState: vi.fn(async () => ({
        success: true,
        isDirty: false,
        uncommittedCount: 0,
        untrackedCount: 0,
      })),
      abortMerge: vi.fn(async () => okResult()),
      hasMergeConflict: vi.fn(async () => false),
      addAndCommit: vi.fn(async () => okResult()),
      revListCount: vi.fn(async () => ({ success: true, count: 0 })),
      analyzeDivergence: vi.fn(async () => ({
        success: true,
        analysis: {
          hasConflicts: false,
          autoMergeable: true,
          conflicts: [],
          blockers: [],
        },
      })),
      applyMerge: vi.fn(async () => ({ success: true, pushed: true })),
    } as unknown as MockedObject<GitAPI>,

    setGitSnapshot(snapshot) {
      snapshots.set(snapshot.projectId, snapshot);
    },
    pushGitSnapshot(snapshot) {
      snapshots.set(snapshot.projectId, snapshot);
      gitStateChanged.emit(snapshot);
    },

    emitLog: logs.emit,
    emitError: errors.emit,
    emitClose: closes.emit,
    emitProgress: progress.emit,
    emitRestarting: restarting.emit,
    emitRestarted: () => restarted.emit(undefined as void),
    emitRestartFailed: () => restartFailed.emit(undefined as void),
    emitRpcQueue: rpcQueue.emit,
    emitAuthUpdate: authUpdates.emit,
    emitDeviceFlowStatus: deviceFlow.emit,

    gitStateSubscriberCount: () => gitStateChanged.size,
  };

  return mock;
}

const BRIDGE_KEYS = [
  'colrev',
  'fileOps',
  'pdfFiles',
  'appInfo',
  'auth',
  'gitState',
  'github',
  'git',
] as const;

/**
 * Install a fresh mock onto the global `window`. Call before the first
 * `useXStore()` of a test: some stores subscribe to bridge channels at store
 * creation time (`git.ts` wires `window.gitState.onChanged`).
 */
export function installWindowMock(): WindowMock {
  const mock = createWindowMock();
  for (const key of BRIDGE_KEYS) {
    Object.defineProperty(globalThis.window, key, {
      value: mock[key],
      configurable: true,
      writable: true,
    });
  }
  return mock;
}

export function uninstallWindowMock(): void {
  const win = globalThis.window as unknown as Record<string, unknown> | undefined;
  if (!win) return;
  for (const key of BRIDGE_KEYS) delete win[key];
}
