/**
 * The renderer in a plain browser (the agentixxx preview): the `window.*` APIs
 * the preload defines in Electron, defined here over the main process's web
 * bridge (main/web-bridge.ts) at `/__bridge`, which the Vite dev server proxies.
 *
 * Calls and events are the same channels as the preload's; only the native
 * dialogs differ: saving downloads the file, opening uploads it.
 */

const BASE = '/__bridge';

type Listener = (...args: unknown[]) => void;

/** True in a browser on the web bridge, false inside Electron. */
export function isWebBridge(): boolean {
  if (typeof window === 'undefined') return false;
  return (window as { __colrevWebBridge?: boolean }).__colrevWebBridge === true;
}

export function installWebBridge(): void {
  const listeners = new Map<string, Set<Listener>>();

  const events = new EventSource(`${BASE}/events`);
  events.onmessage = (message) => {
    const { channel, args } = JSON.parse(message.data) as { channel: string; args: unknown[] };
    for (const listener of listeners.get(channel) ?? []) listener(...args);
  };

  const on =
    (channel: string) =>
    (callback: Listener): (() => void) => {
      let set = listeners.get(channel);
      if (!set) listeners.set(channel, (set = new Set()));
      set.add(callback);
      return () => set.delete(callback);
    };

  async function invoke(channel: string, ...args: unknown[]): Promise<unknown> {
    // JSON turns an undefined argument into null: drop trailing ones so an
    // omitted optional parameter stays omitted.
    while (args.length && args[args.length - 1] === undefined) args.pop();
    const response = await fetch(`${BASE}/invoke`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channel, args }),
    });
    if (!response.ok) {
      throw new Error(`Error invoking remote method '${channel}': HTTP ${response.status}`);
    }
    const body = (await response.json()) as
      | { ok: true; value?: unknown }
      | { ok: false; error: { message: string } };
    if (!body.ok) throw new Error(body.error.message);
    return body.value;
  }

  const call =
    (channel: string) =>
    (...args: unknown[]) =>
      invoke(channel, ...args);

  type Filters = { name: string; extensions: string[] }[] | undefined;

  function download(href: string, name: string): void {
    const link = document.createElement('a');
    link.href = href;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
  }

  async function postJson<T>(route: string, body: unknown): Promise<T> {
    const response = await fetch(`${BASE}${route}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!response.ok) throw new Error(`${route} failed: HTTP ${response.status}`);
    return (await response.json()) as T;
  }

  function pickFile(filters: Filters): Promise<File | null> {
    return new Promise((resolve) => {
      const input = document.createElement('input');
      input.type = 'file';
      const extensions = (filters ?? [])
        .flatMap((f) => f.extensions)
        .filter((ext) => ext !== '*')
        .map((ext) => `.${ext}`);
      if (extensions.length) input.accept = extensions.join(',');
      input.addEventListener('change', () => resolve(input.files?.[0] ?? null));
      input.addEventListener('cancel', () => resolve(null));
      input.click();
    });
  }

  const fileOps = {
    async saveDialog(options: { defaultName: string; content: string }) {
      const url = URL.createObjectURL(new Blob([options.content], { type: 'text/plain' }));
      download(url, options.defaultName);
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
      return { success: true, filePath: options.defaultName };
    },
    // A path on the machine the app runs on; the caller writes the file there
    // and then calls deliverSavedFile, which downloads it to this browser.
    async chooseSavePath(options: { defaultName?: string }) {
      const { filePath } = await postJson<{ filePath: string }>('/save-path', {
        defaultName: options.defaultName ?? 'download',
      });
      return { success: true, filePath };
    },
    async deliverSavedFile(filePath: string) {
      const name = filePath.split(/[\\/]/).pop() ?? 'download';
      download(`${BASE}/download?path=${encodeURIComponent(filePath)}`, name);
    },
    // Uploads the chosen file to the machine the app runs on and returns its path there.
    async openDialog(options: { filters?: Filters }) {
      const file = await pickFile(options.filters);
      if (!file) return { success: false, canceled: true };
      const response = await fetch(`${BASE}/upload?name=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        body: file,
      });
      if (!response.ok) return { success: false, error: `Upload failed: HTTP ${response.status}` };
      const { filePath } = (await response.json()) as { filePath: string };
      return { success: true, filePath };
    },
  };

  const w = window as unknown as Record<string, unknown>;
  w.__colrevWebBridge = true;

  w.colrev = {
    start: call('colrev:start'),
    call: call('colrev:call'),
    stop: call('colrev:stop'),
    onLog: on('colrev:log'),
    onError: on('colrev:error'),
    onClose: on('colrev:close'),
    onProgress: on('colrev:progress'),
    onRestarting: on('colrev:restarting'),
    onRestarted: on('colrev:restarted'),
    onLateResponse: on('colrev:late-response'),
    onRestartFailed: on('colrev:restart-failed'),
    onRpcQueue: on('colrev:rpc-queue'),
  };

  w.fileOps = fileOps;

  w.pdfFiles = { exists: call('pdf:exists') };

  w.auth = {
    getSession: call('auth:get-session'),
    getCachedSession: call('auth:get-cached-session'),
    login: call('auth:login'),
    cancelLogin: call('auth:cancel-login'),
    logout: call('auth:logout'),
    // The token stays on the machine the app runs on (main/web-bridge.ts refuses it).
    getToken: async () => null,
    listAccounts: call('auth:list-accounts'),
    switchAccount: call('auth:switch-account'),
    removeAccount: call('auth:remove-account'),
    onAuthUpdate: on('auth:update'),
    onDeviceFlowStatus: on('auth:device-flow-status'),
  };

  w.github = {
    createRepoAndPush: call('github:create-repo-and-push'),
    listColrevRepos: call('github:list-colrev-repos'),
    cloneRepo: call('github:clone-repo'),
    listReleases: call('github:list-releases'),
    listCollaborators: call('github:list-collaborators'),
    addCollaborator: call('github:add-collaborator'),
    inviteUserSuggestions: call('github:invite-user-suggestions'),
    listPendingInvitations: call('github:list-pending-invitations'),
    listInvitations: call('github:list-invitations'),
    acceptInvitation: call('github:accept-invitation'),
    declineInvitation: call('github:decline-invitation'),
    createRelease: call('github:create-release'),
  };

  w.git = {
    fetch: call('git:fetch'),
    pull: call('git:pull'),
    fastForwardMain: call('git:fast-forward-main'),
    push: call('git:push'),
    pushBranch: call('git:push-branch'),
    listBranches: call('git:list-branches'),
    createBranch: call('git:create-branch'),
    createLocalBranch: call('git:create-local-branch'),
    deleteLocalBranch: call('git:delete-local-branch'),
    deleteRemoteBranch: call('git:delete-remote-branch'),
    checkout: call('git:checkout'),
    merge: call('git:merge'),
    log: call('git:log'),
    dirtyState: call('git:dirty-state'),
    abortMerge: call('git:abort-merge'),
    hasMergeConflict: call('git:has-merge-conflict'),
    revListCount: call('git:rev-list-count'),
    analyzeDivergence: call('git:analyze-divergence'),
    applyMerge: call('git:apply-merge'),
  };

  w.gitState = {
    refresh: call('git-state:refresh'),
    get: call('git-state:get'),
    forget: call('git-state:forget'),
    onChanged: on('git-state-changed'),
  };

  w.appInfo = { get: call('app:info') };
}

/** The URL a project's PDF is served at: the colrev-pdf:// protocol in Electron, the bridge in a browser. */
export function pdfFileUrl(projectId: string, relativePath: string, suffix = ''): string {
  // The handlers decode each path segment, so encode each one: a `#`, `?` or
  // `%` in a file name would otherwise cut or break the URL.
  const encodedPath = relativePath.split('/').map(encodeURIComponent).join('/');
  const root = isWebBridge() ? `${BASE}/pdf` : 'colrev-pdf://pdf';
  return `${root}/${encodeURIComponent(projectId)}/${encodedPath}${suffix}`;
}
