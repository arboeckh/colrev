import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock electron before importing the module under test. The mocks are simple:
// - app.getPath('userData') points at a per-test temp directory
// - safeStorage just base64-encodes/decodes (no real OS keychain in tests)
let userDataDir = '';

vi.mock('electron', () => {
  return {
    app: {
      getPath: (key: string) => {
        if (key === 'userData') return userDataDir;
        throw new Error(`Unexpected getPath: ${key}`);
      },
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: (s: string) => Buffer.from(s),
      decryptString: (b: Buffer) => b.toString('utf-8'),
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
