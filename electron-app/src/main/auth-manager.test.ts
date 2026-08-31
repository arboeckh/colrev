import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron before importing the module under test. The mocks are simple:
// - app.getPath('userData') points at a per-test temp directory
// - safeStorage just base64-encodes/decodes (no real OS keychain in tests).
//   Tests that need the keychain path flip `safeStorageAvailable` and install a
//   `decryptOverride` (e.g. one that throws, to exercise eviction on decrypt
//   failure). Defaults keep the original "encryption unavailable" behavior.
let userDataDir = '';
let safeStorageAvailable = false;
let decryptOverride: ((b: Buffer) => string) | null = null;

vi.mock('electron', () => {
  return {
    app: {
      getPath: (key: string) => {
        if (key === 'userData') return userDataDir;
        throw new Error(`Unexpected getPath: ${key}`);
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => safeStorageAvailable,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => (decryptOverride ? decryptOverride(b) : b.toString('utf-8')),
    },
  };
});

import { AuthManager, NetworkError, AuthError } from './auth-manager';

const sampleUser = { login: 'alice', name: 'Alice', avatarUrl: 'https://x', email: null };

function seedAccount(): void {
  const store = {
    version: 2,
    activeLogin: sampleUser.login,
    accounts: [
      {
        encryptedToken: Buffer.from('token-alice').toString('base64'),
        user: sampleUser,
        authenticatedAt: '2026-05-01T00:00:00Z',
      },
    ],
  };
  fs.writeFileSync(path.join(userDataDir, 'auth.json'), JSON.stringify(store), 'utf-8');
}

describe('AuthManager — offline behavior', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-test-'));
    seedAccount();
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('keeps the account and returns cached session when fetch throws (offline)', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;

    const mgr = new AuthManager();
    const session = await mgr.getSession();

    expect(session).not.toBeNull();
    expect(session?.user.login).toBe('alice');
    // auth.json must still hold the account
    const onDisk = JSON.parse(fs.readFileSync(path.join(userDataDir, 'auth.json'), 'utf-8'));
    expect(onDisk.accounts).toHaveLength(1);
    expect(onDisk.activeLogin).toBe('alice');
  });

  it('keeps the account when GitHub returns a 5xx (transient network)', async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response('boom', { status: 503 }))) as unknown as typeof fetch;

    const mgr = new AuthManager();
    const session = await mgr.getSession();

    expect(session).not.toBeNull();
    const onDisk = JSON.parse(fs.readFileSync(path.join(userDataDir, 'auth.json'), 'utf-8'));
    expect(onDisk.accounts).toHaveLength(1);
  });

  it('removes the account when GitHub returns 401 (token rejected)', async () => {
    global.fetch = vi.fn(() => Promise.resolve(new Response('unauthorized', { status: 401 }))) as unknown as typeof fetch;

    const mgr = new AuthManager();
    const session = await mgr.getSession();

    expect(session).toBeNull();
    const onDisk = JSON.parse(fs.readFileSync(path.join(userDataDir, 'auth.json'), 'utf-8'));
    expect(onDisk.accounts).toHaveLength(0);
  });

  it('refreshes the cached profile on a successful 200 response', async () => {
    const updated = { login: 'alice', name: 'Alice Updated', avatar_url: 'https://new', email: 'alice@example.com' };
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response(JSON.stringify(updated), { status: 200, headers: { 'Content-Type': 'application/json' } })),
    ) as unknown as typeof fetch;

    const mgr = new AuthManager();
    const session = await mgr.getSession();

    expect(session).not.toBeNull();
    expect(session?.user.name).toBe('Alice Updated');
  });

  it('getCachedSession returns the active account without touching the network', async () => {
    // Make fetch blow up so any network call would surface as a test failure.
    global.fetch = vi.fn(() => {
      throw new Error('network must not be called');
    }) as unknown as typeof fetch;

    const mgr = new AuthManager();
    const session = mgr.getCachedSession();

    expect(session).not.toBeNull();
    expect(session?.user.login).toBe('alice');
  });

  it('getCachedSession returns null when there is no active account', () => {
    fs.unlinkSync(path.join(userDataDir, 'auth.json'));
    const mgr = new AuthManager();
    expect(mgr.getCachedSession()).toBeNull();
  });

  it('exports NetworkError and AuthError as distinguishable classes', () => {
    expect(new NetworkError('x')).toBeInstanceOf(NetworkError);
    expect(new AuthError('x')).toBeInstanceOf(AuthError);
    expect(new NetworkError('x')).not.toBeInstanceOf(AuthError);
  });
});


describe('AuthManager — device flow network failures', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-devflow-'));
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  /**
   * Device-code handshake succeeds; every token poll then fails at the
   * transport. `interval`/`expires_in` are tiny so the poll loop runs to its
   * deadline within the test.
   */
  function mockOfflinePolling(expiresInSeconds: number): void {
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dc-1',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            interval: 0.01,
            expires_in: expiresInSeconds,
          }),
        } as unknown as Response;
      }
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
  }

  it('reports network_error while polling instead of silently retrying', async () => {
    const manager = new AuthManager();
    const statuses: string[] = [];
    let userCodeAtNetworkError: string | undefined;
    manager.setDeviceFlowCallback((status) => {
      statuses.push(status.status);
      if (status.status === 'network_error' && userCodeAtNetworkError === undefined) {
        userCodeAtNetworkError = status.userCode;
      }
    });

    mockOfflinePolling(0.2);
    await manager.startDeviceFlow();

    expect(statuses).toContain('network_error');
    // The code is still valid while polling continues — the UI keeps showing it.
    expect(userCodeAtNetworkError).toBe('ABCD-1234');
  });

  it('ends on network_error rather than expired when the window closes offline', async () => {
    const manager = new AuthManager();
    const statuses: string[] = [];
    manager.setDeviceFlowCallback((status) => statuses.push(status.status));

    mockOfflinePolling(0.2);
    await manager.startDeviceFlow();

    expect(statuses[statuses.length - 1]).toBe('network_error');
    expect(statuses).not.toContain('expired');
  });
});

// --- helpers for the multi-account suites ----------------------------------

const bobUser = { login: 'bob', name: 'Bob', avatarUrl: 'https://y', email: null };

interface DiskAccount {
  encryptedToken: string;
  user: { login: string; name: string | null; avatarUrl: string; email: string | null };
  authenticatedAt: string;
}

function account(user: typeof sampleUser, token: string): DiskAccount {
  return {
    encryptedToken: Buffer.from(token).toString('base64'),
    user,
    authenticatedAt: '2026-05-01T00:00:00Z',
  };
}

function authFilePath(): string {
  return path.join(userDataDir, 'auth.json');
}

function writeAuthFile(store: unknown): void {
  fs.writeFileSync(authFilePath(), JSON.stringify(store), 'utf-8');
}

function readAuthFile(): { version: number; activeLogin: string; accounts: DiskAccount[] } {
  return JSON.parse(fs.readFileSync(authFilePath(), 'utf-8'));
}

function seedTwoAccounts(activeLogin = 'alice'): void {
  writeAuthFile({
    version: 2,
    activeLogin,
    accounts: [account(sampleUser, 'token-alice'), account(bobUser, 'token-bob')],
  });
}

/** A fetch stub that fails the test loudly if any network call is attempted. */
function installNoNetworkFetch(): void {
  global.fetch = vi.fn(() => {
    throw new Error('network must not be called');
  }) as unknown as typeof fetch;
}

describe('AuthManager — account switching', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-switch-'));
    seedTwoAccounts('alice');
    originalFetch = global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    safeStorageAvailable = false;
    decryptOverride = null;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('returns null for an unknown login and leaves the store untouched', async () => {
    installNoNetworkFetch();
    const mgr = new AuthManager();
    const updates: unknown[] = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    expect(await mgr.switchAccount('mallory')).toBeNull();

    const onDisk = readAuthFile();
    expect(onDisk.activeLogin).toBe('alice');
    expect(onDisk.accounts.map((a) => a.user.login)).toEqual(['alice', 'bob']);
    expect(updates).toEqual([]);
  });

  it('evicts the target account when its token cannot be decrypted', async () => {
    installNoNetworkFetch();
    safeStorageAvailable = true;
    decryptOverride = (b) => {
      if (b.toString('utf-8') === 'token-bob') throw new Error('keychain refused');
      return b.toString('utf-8');
    };
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    expect(await mgr.switchAccount('bob')).toBeNull();

    const onDisk = readAuthFile();
    expect(onDisk.accounts.map((a) => a.user.login)).toEqual(['alice']);
    expect(onDisk.activeLogin).toBe('alice');
    // removeAccount emits the still-active account so the UI stays consistent.
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('alice');
  });

  it('evicts the target account when GitHub rejects its token (401)', async () => {
    global.fetch = vi.fn(() =>
      Promise.resolve(new Response('unauthorized', { status: 401 })),
    ) as unknown as typeof fetch;
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    expect(await mgr.switchAccount('bob')).toBeNull();

    const onDisk = readAuthFile();
    expect(onDisk.accounts.map((a) => a.user.login)).toEqual(['alice']);
    expect(onDisk.activeLogin).toBe('alice');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('alice');
  });

  it('persists the switch and returns the cached profile when offline', async () => {
    global.fetch = vi.fn(() => Promise.reject(new TypeError('fetch failed'))) as unknown as typeof fetch;
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    const session = await mgr.switchAccount('bob');

    expect(session?.user.login).toBe('bob');
    expect(session?.user.name).toBe('Bob'); // cached profile, not refreshed
    const onDisk = readAuthFile();
    expect(onDisk.activeLogin).toBe('bob'); // the switch itself survived
    expect(onDisk.accounts).toHaveLength(2);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('bob');
  });

  it('updates activeLogin and refreshes the profile on a successful switch', async () => {
    const refreshed = { login: 'bob', name: 'Bob Updated', avatar_url: 'https://new', email: 'bob@example.com' };
    global.fetch = vi.fn(() =>
      Promise.resolve(
        new Response(JSON.stringify(refreshed), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    ) as unknown as typeof fetch;
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string; name: string | null } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    const session = await mgr.switchAccount('bob');

    expect(session?.user.login).toBe('bob');
    expect(session?.user.name).toBe('Bob Updated');
    const onDisk = readAuthFile();
    expect(onDisk.activeLogin).toBe('bob');
    expect(onDisk.accounts.find((a) => a.user.login === 'bob')?.user.name).toBe('Bob Updated');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.name).toBe('Bob Updated');
  });

  it('switchAccountLocal flips the active login without touching the network', () => {
    installNoNetworkFetch();
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    const session = mgr.switchAccountLocal('bob');

    expect(session?.user.login).toBe('bob');
    expect(readAuthFile().activeLogin).toBe('bob');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('bob');
  });

  it('switchAccountLocal returns null for an unknown login and emits nothing', () => {
    installNoNetworkFetch();
    const mgr = new AuthManager();
    const updates: unknown[] = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    expect(mgr.switchAccountLocal('mallory')).toBeNull();
    expect(readAuthFile().activeLogin).toBe('alice');
    expect(updates).toEqual([]);
  });
});

describe('AuthManager — account removal and logout', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-remove-'));
    originalFetch = global.fetch;
    installNoNetworkFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('falls back to the remaining account when the active one is removed', () => {
    seedTwoAccounts('alice');
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    mgr.removeAccount('alice');

    const onDisk = readAuthFile();
    expect(onDisk.accounts.map((a) => a.user.login)).toEqual(['bob']);
    expect(onDisk.activeLogin).toBe('bob');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('bob');
  });

  it('leaves activeLogin alone when a non-active account is removed', () => {
    seedTwoAccounts('alice');
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    mgr.removeAccount('bob');

    const onDisk = readAuthFile();
    expect(onDisk.accounts.map((a) => a.user.login)).toEqual(['alice']);
    expect(onDisk.activeLogin).toBe('alice');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('alice');
  });

  it('emits null when the last account is removed', () => {
    seedAccount(); // single alice account
    const mgr = new AuthManager();
    const updates: unknown[] = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    mgr.removeAccount('alice');

    const onDisk = readAuthFile();
    expect(onDisk.accounts).toEqual([]);
    expect(onDisk.activeLogin).toBe('');
    expect(updates).toEqual([null]);
  });

  it('logout removes only the active account when others exist', async () => {
    seedTwoAccounts('alice');
    const mgr = new AuthManager();
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    await mgr.logout();

    const onDisk = readAuthFile();
    expect(onDisk.accounts.map((a) => a.user.login)).toEqual(['bob']);
    expect(onDisk.activeLogin).toBe('bob');
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('bob');
  });

  it('logout with a single account leaves an empty store and emits null', async () => {
    seedAccount();
    const mgr = new AuthManager();
    const updates: unknown[] = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    await mgr.logout();

    // Implementation keeps the file but empties it (removeAccount path).
    const onDisk = readAuthFile();
    expect(onDisk.accounts).toEqual([]);
    expect(onDisk.activeLogin).toBe('');
    expect(updates).toEqual([null]);
    expect(mgr.getCachedSession()).toBeNull();
  });

  it('logout with no active login unlinks auth.json and emits null', async () => {
    writeAuthFile({ version: 2, activeLogin: '', accounts: [] });
    const mgr = new AuthManager();
    const updates: unknown[] = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    await mgr.logout();

    expect(fs.existsSync(authFilePath())).toBe(false);
    expect(updates).toEqual([null]);
  });
});

describe('AuthManager — device flow outcomes', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-devsuccess-'));
    originalFetch = global.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    global.fetch = originalFetch;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  /**
   * Full fake GitHub for the device flow: handshake, token polls (one queued
   * response per poll, last one repeats), and the user-profile endpoint.
   */
  function mockDeviceFlow(opts: {
    interval?: number;
    tokenResponses: Array<Record<string, unknown>>;
    userLogin?: string;
  }): { tokenPolls: () => number } {
    let pollCount = 0;
    global.fetch = vi.fn(async (url: string | URL | Request) => {
      const href = typeof url === 'string' ? url : url.toString();
      if (href.includes('device/code')) {
        return {
          ok: true,
          json: async () => ({
            device_code: 'dc-1',
            user_code: 'ABCD-1234',
            verification_uri: 'https://github.com/login/device',
            interval: opts.interval ?? 1,
            expires_in: 900,
          }),
        } as unknown as Response;
      }
      if (href.includes('login/oauth/access_token')) {
        const idx = Math.min(pollCount, opts.tokenResponses.length - 1);
        pollCount += 1;
        return { ok: true, json: async () => opts.tokenResponses[idx] } as unknown as Response;
      }
      if (href.includes('api.github.com/user')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({
            login: opts.userLogin ?? 'alice',
            name: 'Alice',
            avatar_url: 'https://x',
            email: null,
          }),
        } as unknown as Response;
      }
      throw new Error(`Unexpected fetch: ${href}`);
    }) as unknown as typeof fetch;
    return { tokenPolls: () => pollCount };
  }

  function watch(mgr: AuthManager) {
    const statuses: Array<{ status: string; error?: string }> = [];
    const updates: Array<{ user: { login: string } } | null> = [];
    mgr.setDeviceFlowCallback((s) => statuses.push(s));
    mgr.setAuthUpdateCallback((s) => updates.push(s));
    return { statuses, updates };
  }

  it('stores the account, sets it active and emits success + auth update', async () => {
    mockDeviceFlow({
      tokenResponses: [{ error: 'authorization_pending' }, { access_token: 'gho_new' }],
    });
    const mgr = new AuthManager();
    const { statuses, updates } = watch(mgr);

    const flow = mgr.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(3000);
    await flow;

    expect(statuses.map((s) => s.status)).toEqual(['awaiting_code', 'polling', 'success']);
    expect(updates).toHaveLength(1);
    expect(updates[0]?.user.login).toBe('alice');

    const onDisk = readAuthFile();
    expect(onDisk.activeLogin).toBe('alice');
    expect(onDisk.accounts).toHaveLength(1);
    // safeStorage is unavailable in tests, so the token is stored base64-encoded.
    expect(onDisk.accounts[0].encryptedToken).toBe(Buffer.from('gho_new').toString('base64'));
    expect(new Date(onDisk.accounts[0].authenticatedAt).toString()).not.toBe('Invalid Date');
  });

  it('re-authenticating the same login replaces the entry instead of duplicating it', async () => {
    seedAccount(); // alice already stored with token-alice
    mockDeviceFlow({ tokenResponses: [{ access_token: 'gho_replacement' }] });
    const mgr = new AuthManager();
    watch(mgr);

    const flow = mgr.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(2000);
    await flow;

    const onDisk = readAuthFile();
    expect(onDisk.accounts).toHaveLength(1);
    expect(onDisk.accounts[0].user.login).toBe('alice');
    expect(onDisk.accounts[0].encryptedToken).toBe(Buffer.from('gho_replacement').toString('base64'));
    expect(onDisk.activeLogin).toBe('alice');
  });

  it('backs off after slow_down and still completes the login', async () => {
    // First poll at t=1s answers slow_down with interval 2 → next poll waits
    // (2 + 5)s, i.e. lands at t=8s.
    const flowMock = mockDeviceFlow({
      tokenResponses: [{ error: 'slow_down', interval: 2 }, { access_token: 'gho_slow' }],
    });
    const mgr = new AuthManager();
    const { statuses } = watch(mgr);

    const flow = mgr.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(1100);
    expect(flowMock.tokenPolls()).toBe(1);

    // Well past the original 1s cadence but before the backed-off interval:
    // no extra poll may have happened.
    await vi.advanceTimersByTimeAsync(5000); // t ≈ 6.1s
    expect(flowMock.tokenPolls()).toBe(1);

    await vi.advanceTimersByTimeAsync(3000); // t ≈ 9.1s — past the 8s mark
    await flow;

    expect(flowMock.tokenPolls()).toBe(2);
    expect(statuses[statuses.length - 1]?.status).toBe('success');
    expect(readAuthFile().activeLogin).toBe('alice');
  });

  it('reports expired when GitHub says the device code expired', async () => {
    mockDeviceFlow({ tokenResponses: [{ error: 'expired_token' }] });
    const mgr = new AuthManager();
    const { statuses, updates } = watch(mgr);

    const flow = mgr.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(2000);
    await flow;

    expect(statuses[statuses.length - 1]?.status).toBe('expired');
    expect(updates).toEqual([]);
    expect(fs.existsSync(authFilePath())).toBe(false);
  });

  it('reports an error when the user denies access', async () => {
    mockDeviceFlow({ tokenResponses: [{ error: 'access_denied' }] });
    const mgr = new AuthManager();
    const { statuses, updates } = watch(mgr);

    const flow = mgr.startDeviceFlow();
    await vi.advanceTimersByTimeAsync(2000);
    await flow;

    const last = statuses[statuses.length - 1];
    expect(last?.status).toBe('error');
    expect(last?.error).toBe('Access denied by user');
    expect(updates).toEqual([]);
    expect(fs.existsSync(authFilePath())).toBe(false);
  });
});

describe('AuthManager — store robustness', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-store-'));
    originalFetch = global.fetch;
    installNoNetworkFetch();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('migrates a legacy single-account auth.json to v2 on first read', () => {
    writeAuthFile({
      encryptedToken: Buffer.from('token-alice').toString('base64'),
      user: sampleUser,
      authenticatedAt: '2026-01-01T00:00:00Z',
    });
    const mgr = new AuthManager();

    const session = mgr.getCachedSession();
    expect(session?.user.login).toBe('alice');
    expect(session?.authenticatedAt).toBe('2026-01-01T00:00:00Z');

    // Migration is persisted, not just in memory.
    const onDisk = readAuthFile();
    expect(onDisk.version).toBe(2);
    expect(onDisk.activeLogin).toBe('alice');
    expect(onDisk.accounts).toHaveLength(1);
    expect(onDisk.accounts[0].user.login).toBe('alice');
  });

  it('treats a corrupt auth.json as an empty store instead of throwing', () => {
    fs.writeFileSync(authFilePath(), 'not-json{{{', 'utf-8');
    const mgr = new AuthManager();

    expect(mgr.getCachedSession()).toBeNull();
    expect(mgr.listAccounts()).toEqual([]);
    expect(mgr.getActiveLogin()).toBeNull();
  });

  it('getActiveLogin is null but getCachedSession falls back to the first account when activeLogin is stale', () => {
    writeAuthFile({
      version: 2,
      activeLogin: 'ghost',
      accounts: [account(sampleUser, 'token-alice')],
    });
    const mgr = new AuthManager();

    // Documented asymmetry: the login getter reports no active login, while
    // the account getter falls back to accounts[0].
    expect(mgr.getActiveLogin()).toBeNull();
    expect(mgr.getCachedSession()?.user.login).toBe('alice');
    expect(mgr.listAccounts()).toEqual([
      { login: 'alice', name: 'Alice', avatarUrl: 'https://x', isActive: false },
    ]);
  });
});

describe('AuthManager — decrypt-failure eviction', () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-auth-decrypt-'));
    seedAccount();
    originalFetch = global.fetch;
    installNoNetworkFetch();
    safeStorageAvailable = true;
    decryptOverride = () => {
      throw new Error('keychain refused the token');
    };
  });

  afterEach(() => {
    global.fetch = originalFetch;
    safeStorageAvailable = false;
    decryptOverride = null;
    fs.rmSync(userDataDir, { recursive: true, force: true });
  });

  it('getSession evicts the account and emits null when decryption fails', async () => {
    const mgr = new AuthManager();
    const updates: unknown[] = [];
    mgr.setAuthUpdateCallback((s) => updates.push(s));

    expect(await mgr.getSession()).toBeNull();

    const onDisk = readAuthFile();
    expect(onDisk.accounts).toEqual([]);
    expect(onDisk.activeLogin).toBe('');
    expect(updates).toEqual([null]);
  });

  it('getToken returns null on decrypt failure without evicting the account', () => {
    const mgr = new AuthManager();

    expect(mgr.getToken()).toBeNull();
    // Unlike getSession, getToken leaves the store alone.
    expect(readAuthFile().accounts).toHaveLength(1);
  });
});
