/**
 * The auth store against the real `window.auth` bridge shape (WP-08 §1).
 *
 * The store's job is sequencing, not authentication: subscribe before reading
 * so no auth:update is missed, render the cached profile before any network
 * or keychain access, and only clear a session when GitHub explicitly rejects
 * the token — never on a network failure.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useAuthStore } from './auth';
import { useConnectionStore } from './connection';
import { setupRendererTest, type RendererTestContext } from '@/test/harness';
import type { AccountInfo, AuthSession } from '@/types/window';

function makeSession(login: string, name: string | null = null): AuthSession {
  return {
    user: {
      login,
      name,
      avatarUrl: `https://avatars.example/${login}`,
      email: null,
    },
    authenticatedAt: '2026-01-01T00:00:00Z',
  };
}

function makeAccount(login: string, isActive = false): AccountInfo {
  return { login, name: login, avatarUrl: `https://avatars.example/${login}`, isActive };
}

/** Let the void'ed background-validation chain settle. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * `isMacPlatform()` reads `navigator.platform`; happy-dom derives it from the
 * host OS, so pin it per test. The own property shadows the prototype getter
 * and is removed again in `restorePlatform`.
 */
function stubPlatform(platform: string): void {
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true,
  });
}

function restorePlatform(): void {
  delete (window.navigator as unknown as Record<string, unknown>).platform;
}

let ctx: RendererTestContext;

beforeEach(() => {
  ctx = setupRendererTest();
  // Non-mac unless a test opts in: the keychain explainer must not gate
  // validation in the platform-agnostic tests.
  stubPlatform('Win32');
});

afterEach(() => {
  restorePlatform();
});

describe('initialize', () => {
  it('subscribes to auth updates before reading accounts or sessions', async () => {
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    const auth = useAuthStore();

    await auth.initialize();

    const subscribedAt = ctx.mock.auth.onAuthUpdate.mock.invocationCallOrder[0];
    expect(subscribedAt).toBeLessThan(ctx.mock.auth.listAccounts.mock.invocationCallOrder[0]);
    expect(subscribedAt).toBeLessThan(ctx.mock.auth.getCachedSession.mock.invocationCallOrder[0]);
  });

  it('does not miss an auth:update fired while getSession is in flight', async () => {
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    // Main pushes the session over the event channel during validation and
    // resolves the call with null — the subscriber must have caught the push.
    ctx.mock.auth.getSession.mockImplementation(async () => {
      ctx.mock.emitAuthUpdate(makeSession('alice'));
      return null;
    });
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    expect(auth.user?.login).toBe('alice');
    expect(auth.isAuthenticated).toBe(true);
  });

  it('renders the cached profile immediately, before validation resolves', async () => {
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    // Validation hangs (offline, slow network) — boot must not wait for it.
    ctx.mock.auth.getSession.mockReturnValue(new Promise(() => {}));
    const auth = useAuthStore();

    await auth.initialize();

    expect(auth.isLoading).toBe(false);
    expect(auth.user?.login).toBe('alice');
    expect(auth.hasAccess).toBe(true);
  });

  it('skips background validation entirely when no account is stored', async () => {
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    expect(auth.isLoading).toBe(false);
    expect(auth.session).toBeNull();
    expect(ctx.mock.auth.getSession).not.toHaveBeenCalled();
  });
});

describe('background validation', () => {
  it('refreshes the cached profile from the validated session', async () => {
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice', null));
    ctx.mock.auth.getSession.mockResolvedValue(makeSession('alice', 'Alice Author'));
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    expect(auth.user?.name).toBe('Alice Author');
  });

  it('clears the session when GitHub explicitly rejected the token', async () => {
    let accounts: AccountInfo[] = [makeAccount('alice', true)];
    ctx.mock.auth.listAccounts.mockImplementation(async () => accounts);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    // Auth error path in main: the account is removed and auth:update(null)
    // is pushed before the call resolves null.
    ctx.mock.auth.getSession.mockImplementation(async () => {
      accounts = [];
      ctx.mock.emitAuthUpdate(null);
      return null;
    });
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    expect(auth.session).toBeNull();
    expect(auth.accounts).toEqual([]);
    expect(auth.hasAccess).toBe(false);
  });

  it('keeps the cached session when validation fails with a network error', async () => {
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.getSession.mockRejectedValue(new Error('getaddrinfo ENOTFOUND github.com'));
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    expect(auth.user?.login).toBe('alice');
    expect(auth.isAuthenticated).toBe(true);
  });

  it('revalidates on reconnect so a token revoked while offline is cleared', async () => {
    let accounts: AccountInfo[] = [makeAccount('alice', true)];
    ctx.mock.auth.listAccounts.mockImplementation(async () => accounts);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.getSession.mockResolvedValue(makeSession('alice'));
    const auth = useAuthStore();
    await auth.initialize();
    await flush();
    expect(ctx.mock.auth.getSession).toHaveBeenCalledTimes(1);

    // The token gets revoked while we're offline...
    ctx.mock.auth.getSession.mockImplementation(async () => {
      accounts = [];
      ctx.mock.emitAuthUpdate(null);
      return null;
    });
    const connection = useConnectionStore();
    connection.markOffline();
    connection.markOnline();
    await flush();

    expect(ctx.mock.auth.getSession).toHaveBeenCalledTimes(2);
    expect(auth.session).toBeNull();
  });
});

describe('switchAccount', () => {
  it('activates the switched-to session and refreshes the account list', async () => {
    let accounts = [makeAccount('alice', true), makeAccount('bob')];
    ctx.mock.auth.listAccounts.mockImplementation(async () => accounts);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.switchAccount.mockImplementation(async (login) => {
      accounts = [makeAccount('alice'), makeAccount('bob', true)];
      return makeSession(login);
    });
    const auth = useAuthStore();
    await auth.initialize();
    await flush();

    await auth.switchAccount('bob');

    expect(ctx.mock.auth.switchAccount).toHaveBeenCalledWith('bob');
    expect(auth.user?.login).toBe('bob');
    expect(auth.accounts.find((a) => a.isActive)?.login).toBe('bob');
  });

  it('leaves the current session in place when the switch fails', async () => {
    ctx.mock.auth.listAccounts.mockResolvedValue([
      makeAccount('alice', true),
      makeAccount('bob'),
    ]);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.switchAccount.mockResolvedValue(null);
    const auth = useAuthStore();
    await auth.initialize();
    await flush();

    await expect(auth.switchAccount('bob')).resolves.toBeNull();

    expect(auth.user?.login).toBe('alice');
    expect(auth.isAuthenticated).toBe(true);
  });
});

describe('logout', () => {
  it('clears the session, then adopts the next account main activates', async () => {
    let accounts = [makeAccount('alice', true), makeAccount('bob')];
    ctx.mock.auth.listAccounts.mockImplementation(async () => accounts);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.logout.mockImplementation(async () => {
      accounts = [makeAccount('bob', true)];
    });
    const auth = useAuthStore();
    await auth.initialize();
    await flush();
    expect(auth.hasMultipleAccounts).toBe(true);

    await auth.logout();

    expect(auth.session).toBeNull();
    expect(auth.accounts).toEqual([makeAccount('bob', true)]);
    expect(auth.hasMultipleAccounts).toBe(false);

    // Main promotes the next account and pushes its session asynchronously.
    ctx.mock.emitAuthUpdate(makeSession('bob'));
    expect(auth.user?.login).toBe('bob');
    expect(auth.isAuthenticated).toBe(true);
  });
});

describe('hasMultipleAccounts', () => {
  it('is false for zero or one account and true for two', async () => {
    const auth = useAuthStore();
    expect(auth.hasMultipleAccounts).toBe(false);

    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    await auth.refreshAccounts();
    expect(auth.hasMultipleAccounts).toBe(false);

    ctx.mock.auth.listAccounts.mockResolvedValue([
      makeAccount('alice', true),
      makeAccount('bob'),
    ]);
    await auth.refreshAccounts();
    expect(auth.hasMultipleAccounts).toBe(true);
  });
});

describe('local mode', () => {
  it('grants access without a session', () => {
    const auth = useAuthStore();
    auth.continueWithoutLogin();

    expect(auth.hasAccess).toBe(true);
    expect(auth.isAuthenticated).toBe(false);
  });

  it('is cleared by a successful sign-in', async () => {
    const auth = useAuthStore();
    await auth.initialize();
    auth.continueWithoutLogin();

    ctx.mock.emitAuthUpdate(makeSession('alice'));

    expect(auth.isLocalMode).toBe(false);
    expect(auth.isAuthenticated).toBe(true);
    expect(auth.hasAccess).toBe(true);
  });
});

describe('macOS keychain explainer gate', () => {
  it('defers background validation until the explainer is acknowledged', async () => {
    stubPlatform('MacIntel');
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.getSession.mockResolvedValue(makeSession('alice'));
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    // Boot still rendered the cached profile — only the safeStorage-touching
    // validation is parked behind the dialog.
    expect(auth.user?.login).toBe('alice');
    expect(auth.keychainExplainerOpen).toBe(true);
    expect(ctx.mock.auth.getSession).not.toHaveBeenCalled();

    auth.acknowledgeKeychainExplainer();
    await flush();

    expect(auth.keychainExplainerOpen).toBe(false);
    expect(localStorage.getItem('colrev:keychain-explained')).toBe('1');
    expect(ctx.mock.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('validates immediately when the explainer was already acknowledged', async () => {
    stubPlatform('MacIntel');
    localStorage.setItem('colrev:keychain-explained', '1');
    ctx.mock.auth.listAccounts.mockResolvedValue([makeAccount('alice', true)]);
    ctx.mock.auth.getCachedSession.mockResolvedValue(makeSession('alice'));
    ctx.mock.auth.getSession.mockResolvedValue(makeSession('alice'));
    const auth = useAuthStore();

    await auth.initialize();
    await flush();

    expect(auth.keychainExplainerOpen).toBe(false);
    expect(ctx.mock.auth.getSession).toHaveBeenCalledTimes(1);
  });
});
