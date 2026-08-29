import { defineHandler, type IpcHandlerSpec } from './registry';

/**
 * IPC handlers that never open a repository: RPC process lifecycle, native
 * dialogs, PDF path resolution, auth, and app metadata.
 *
 * Everything here is lock-free by construction — that is the whole reason the
 * group exists. Anything repo-touching belongs in `git-handlers.ts` or
 * `github-handlers.ts`, which are locked by default.
 */
export interface AppHandlerDeps {
  startBackend(): Promise<unknown>;
  stopBackend(): Promise<unknown>;
  callRpc(method: string, params: Record<string, unknown>): Promise<unknown>;
  saveFileDialog(options: unknown): Promise<unknown>;
  chooseSavePath(options: unknown): Promise<unknown>;
  openFileDialog(options: unknown): Promise<unknown>;
  pdfExists(params: { projectId: string; relativePath: string }): { exists: boolean };
  appInfo(): unknown;
  auth: {
    getSession(): Promise<unknown>;
    getCachedSession(): unknown;
    startDeviceFlow(): Promise<unknown>;
    logout(): unknown;
    getToken(): unknown;
    listAccounts(): unknown;
    switchAccount(login: string): Promise<unknown>;
    removeAccount(login: string): void;
    switchAccountLocal(login: string): { user: { login: string } } | null;
  };
  /** True in E2E runs (fake GitHub registry): exposes `__test/*` channels. */
  includeTestHandlers: boolean;
}

export function createAppHandlers(deps: AppHandlerDeps): IpcHandlerSpec[] {
  const { auth } = deps;
  const lockFree = (channel: string, handler: IpcHandlerSpec['handler'], reason: string) =>
    defineHandler({ channel, handler, lockFree: true, lockFreeReason: reason });

  const specs: IpcHandlerSpec[] = [
    lockFree('colrev:start', () => deps.startBackend(), 'spawns the RPC server; opens no repo'),
    lockFree(
      'colrev:call',
      (_e, method: string, params: Record<string, unknown>) => deps.callRpc(method, params),
      'applies the per-method RPC lock policy itself (see isLockFreeRpcMethod)',
    ),
    lockFree('colrev:stop', () => deps.stopBackend(), 'terminates the RPC server; opens no repo'),

    lockFree('file:save-dialog', (_e, o) => deps.saveFileDialog(o), 'native dialog + write outside any repo'),
    lockFree('file:choose-save-path', (_e, o) => deps.chooseSavePath(o), 'native dialog only'),
    lockFree('file:open-dialog', (_e, o) => deps.openFileDialog(o), 'native dialog only'),
    lockFree('pdf:exists', async (_e, p) => deps.pdfExists(p), 'fs.existsSync on a worktree file; no git state'),
    lockFree('app:info', async () => deps.appInfo(), 'reads app metadata only'),

    lockFree('auth:get-session', () => auth.getSession(), 'auth store + GitHub API; no repo'),
    lockFree('auth:get-cached-session', async () => auth.getCachedSession(), 'auth store only'),
    lockFree('auth:login', () => auth.startDeviceFlow(), 'GitHub device flow; no repo'),
    lockFree('auth:logout', async () => auth.logout(), 'auth store only'),
    lockFree('auth:get-token', async () => auth.getToken(), 'auth store only'),
    lockFree('auth:list-accounts', async () => auth.listAccounts(), 'auth store only'),
    lockFree('auth:switch-account', (_e, login: string) => auth.switchAccount(login), 'auth store + GitHub API'),
    lockFree(
      'auth:remove-account',
      async (_e, login: string) => {
        auth.removeAccount(login);
        return { success: true };
      },
      'auth store only',
    ),
  ];

  if (deps.includeTestHandlers) {
    specs.push(
      lockFree(
        '__test/switchAccount',
        async (_e, login: string) => {
          const session = auth.switchAccountLocal(login);
          return session
            ? { success: true, login: session.user.login }
            : { success: false, error: `Account "${login}" not found` };
        },
        'test-only account switch; auth store only',
      ),
    );
  }

  return specs;
}
