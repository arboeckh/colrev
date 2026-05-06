import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import { FakeGitHubRegistry } from './fake-github-registry';

const GITHUB_CLIENT_ID = 'Ov23li8l88sQbgmXSvgc';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const SCOPES = 'read:user repo workflow';

function fakeRegistryPath(): string | undefined {
  return process.env.COLREV_FAKE_GITHUB_REGISTRY;
}

interface StoredAccount {
  encryptedToken: string;
  user: GitHubUser;
  authenticatedAt: string;
}

/** Legacy single-account format (for migration). */
interface LegacyStoredAuth {
  encryptedToken: string;
  user: GitHubUser;
  authenticatedAt: string;
}

/** Multi-account store format. */
interface StoredAuthMulti {
  version: 2;
  activeLogin: string;
  accounts: StoredAccount[];
}

export interface GitHubUser {
  login: string;
  name: string | null;
  avatarUrl: string;
  email: string | null;
}

export interface AuthSession {
  user: GitHubUser;
  authenticatedAt: string;
}

export interface AccountInfo {
  login: string;
  name: string | null;
  avatarUrl: string;
  isActive: boolean;
}

export interface DeviceFlowStatus {
  status: 'awaiting_code' | 'polling' | 'success' | 'error' | 'expired';
  userCode?: string;
  verificationUri?: string;
  error?: string;
}

/** Thrown when a request to GitHub fails because the network is unreachable
 * or the server returned an unexpected non-auth status. Callers should treat
 * this as transient and avoid mutating the auth store. */
export class NetworkError extends Error {
  override name = 'NetworkError';
}

/** Thrown when GitHub explicitly rejected the credentials (401 / 403).
 * Callers should remove the offending account. */
export class AuthError extends Error {
  override name = 'AuthError';
}

type AuthEventCallback = (session: AuthSession | null) => void;
type DeviceFlowCallback = (status: DeviceFlowStatus) => void;

export class AuthManager {
  private pollingAbort: AbortController | null = null;
  private onAuthUpdate: AuthEventCallback | null = null;
  private onDeviceFlowStatus: DeviceFlowCallback | null = null;

  private get storePath(): string {
    return path.join(app.getPath('userData'), 'auth.json');
  }

  // --- Store read/write ---

  private readStore(): StoredAuthMulti {
    try {
      if (fs.existsSync(this.storePath)) {
        const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));

        // Already multi-account format
        if (raw.version === 2 && Array.isArray(raw.accounts)) {
          return raw as StoredAuthMulti;
        }

        // Legacy single-account — migrate
        const legacy = raw as LegacyStoredAuth;
        if (legacy.encryptedToken && legacy.user) {
          const migrated: StoredAuthMulti = {
            version: 2,
            activeLogin: legacy.user.login,
            accounts: [{
              encryptedToken: legacy.encryptedToken,
              user: legacy.user,
              authenticatedAt: legacy.authenticatedAt,
            }],
          };
          this.writeStore(migrated);
          return migrated;
        }
      }
    } catch {
      // Corrupt file — ignore
    }
    return { version: 2, activeLogin: '', accounts: [] };
  }

  private writeStore(data: StoredAuthMulti): void {
    fs.writeFileSync(this.storePath, JSON.stringify(data, null, 2), 'utf-8');
  }

  private getActiveAccount(): StoredAccount | null {
    const store = this.readStore();
    if (!store.activeLogin || store.accounts.length === 0) return null;
    return store.accounts.find((a) => a.user.login === store.activeLogin) ?? store.accounts[0];
  }

  // --- Callbacks ---

  setAuthUpdateCallback(cb: AuthEventCallback) {
    this.onAuthUpdate = cb;
  }

  setDeviceFlowCallback(cb: DeviceFlowCallback) {
    this.onDeviceFlowStatus = cb;
  }

  private emitAuthUpdate(session: AuthSession | null) {
    this.onAuthUpdate?.(session);
  }

  private emitDeviceFlowStatus(status: DeviceFlowStatus) {
    this.onDeviceFlowStatus?.(status);
  }

  // --- Session / Token ---

  async getSession(): Promise<AuthSession | null> {
    const account = this.getActiveAccount();
    if (!account) return null;

    let token: string;
    try {
      token = this.decryptToken(account.encryptedToken);
    } catch {
      // Decryption failure is unrecoverable — the keychain rejected the token.
      this.removeAccount(account.user.login);
      return null;
    }

    try {
      const user = await this.fetchUserProfile(token);
      return { user, authenticatedAt: account.authenticatedAt };
    } catch (e) {
      if (e instanceof AuthError) {
        this.removeAccount(account.user.login);
        return null;
      }
      // NetworkError or anything else unexpected: keep the account, return cached profile.
      return { user: account.user, authenticatedAt: account.authenticatedAt };
    }
  }

  /** Returns the active session from on-disk state without hitting the network.
   * Used at boot so the UI can render immediately even when offline. */
  getCachedSession(): AuthSession | null {
    const account = this.getActiveAccount();
    if (!account) return null;
    return { user: account.user, authenticatedAt: account.authenticatedAt };
  }

  getToken(): string | null {
    const account = this.getActiveAccount();
    if (!account) return null;
    try {
      return this.decryptToken(account.encryptedToken);
    } catch {
      return null;
    }
  }

  // --- Multi-account ---

  getActiveLogin(): string | null {
    const store = this.readStore();
    if (!store.activeLogin || store.accounts.length === 0) return null;
    const exists = store.accounts.some((a) => a.user.login === store.activeLogin);
    return exists ? store.activeLogin : null;
  }

  listAccounts(): AccountInfo[] {
    const store = this.readStore();
    return store.accounts.map((a) => ({
      login: a.user.login,
      name: a.user.name,
      avatarUrl: a.user.avatarUrl,
      isActive: a.user.login === store.activeLogin,
    }));
  }

  async switchAccount(login: string): Promise<AuthSession | null> {
    const store = this.readStore();
    const account = store.accounts.find((a) => a.user.login === login);
    if (!account) return null;

    let token: string;
    try {
      token = this.decryptToken(account.encryptedToken);
    } catch {
      this.removeAccount(login);
      return null;
    }

    // Always switch active login locally, regardless of network.
    store.activeLogin = login;

    try {
      const user = await this.fetchUserProfile(token);
      account.user = user;
      this.writeStore(store);
      const session: AuthSession = { user, authenticatedAt: account.authenticatedAt };
      this.emitAuthUpdate(session);
      return session;
    } catch (e) {
      if (e instanceof AuthError) {
        this.removeAccount(login);
        return null;
      }
      // Offline: persist the switch but use cached profile.
      this.writeStore(store);
      const session: AuthSession = { user: account.user, authenticatedAt: account.authenticatedAt };
      this.emitAuthUpdate(session);
      return session;
    }
  }

  switchAccountLocal(login: string): AuthSession | null {
    const store = this.readStore();
    const account = store.accounts.find((a) => a.user.login === login);
    if (!account) return null;

    store.activeLogin = login;
    this.writeStore(store);

    const session: AuthSession = { user: account.user, authenticatedAt: account.authenticatedAt };
    this.emitAuthUpdate(session);
    return session;
  }

  removeAccount(login: string): void {
    const store = this.readStore();
    store.accounts = store.accounts.filter((a) => a.user.login !== login);
    if (store.activeLogin === login) {
      store.activeLogin = store.accounts[0]?.user.login ?? '';
    }
    this.writeStore(store);

    if (store.accounts.length === 0) {
      this.emitAuthUpdate(null);
    } else if (store.activeLogin) {
      const next = store.accounts.find((a) => a.user.login === store.activeLogin);
      if (next) {
        this.emitAuthUpdate({ user: next.user, authenticatedAt: next.authenticatedAt });
      }
    }
  }

  // --- Device flow ---

  async startDeviceFlow(): Promise<void> {
    this.pollingAbort?.abort();

    this.emitDeviceFlowStatus({ status: 'awaiting_code' });

    try {
      const res = await fetch(DEVICE_CODE_URL, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          client_id: GITHUB_CLIENT_ID,
          scope: SCOPES,
        }),
      });

      const data = await res.json();

      if (data.error) {
        this.emitDeviceFlowStatus({ status: 'error', error: data.error_description || data.error });
        return;
      }

      const { device_code, user_code, verification_uri, expires_in, interval } = data;

      this.emitDeviceFlowStatus({
        status: 'polling',
        userCode: user_code,
        verificationUri: verification_uri,
      });

      await this.pollForToken(device_code, interval || 5, expires_in || 900);
    } catch (err) {
      this.emitDeviceFlowStatus({
        status: 'error',
        error: err instanceof Error ? err.message : 'Failed to start device flow',
      });
    }
  }

  private async pollForToken(deviceCode: string, interval: number, expiresIn: number): Promise<void> {
    this.pollingAbort = new AbortController();
    const { signal } = this.pollingAbort;
    const deadline = Date.now() + expiresIn * 1000;
    let pollInterval = interval;

    while (Date.now() < deadline) {
      if (signal.aborted) return;

      await new Promise((resolve) => setTimeout(resolve, pollInterval * 1000));
      if (signal.aborted) return;

      try {
        const res = await fetch(TOKEN_URL, {
          method: 'POST',
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            client_id: GITHUB_CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
          }),
        });

        const data = await res.json();

        if (data.access_token) {
          let user: GitHubUser;
          try {
            user = await this.fetchUserProfile(data.access_token);
          } catch (err) {
            this.emitDeviceFlowStatus({
              status: 'error',
              error: err instanceof Error ? `Failed to fetch user profile: ${err.message}` : 'Failed to fetch user profile',
            });
            return;
          }

          const session: AuthSession = {
            user,
            authenticatedAt: new Date().toISOString(),
          };

          // Add or replace account in store
          const store = this.readStore();
          const existingIdx = store.accounts.findIndex((a) => a.user.login === user.login);
          const account: StoredAccount = {
            encryptedToken: this.encryptToken(data.access_token),
            user,
            authenticatedAt: session.authenticatedAt,
          };

          if (existingIdx >= 0) {
            store.accounts[existingIdx] = account;
          } else {
            store.accounts.push(account);
          }
          store.activeLogin = user.login;
          this.writeStore(store);

          this.emitDeviceFlowStatus({ status: 'success' });
          this.emitAuthUpdate(session);
          return;
        }

        if (data.error === 'slow_down') {
          pollInterval = (data.interval || pollInterval) + 5;
        } else if (data.error === 'authorization_pending') {
          // Keep polling
        } else if (data.error === 'expired_token') {
          this.emitDeviceFlowStatus({ status: 'expired' });
          return;
        } else if (data.error === 'access_denied') {
          this.emitDeviceFlowStatus({ status: 'error', error: 'Access denied by user' });
          return;
        } else if (data.error) {
          this.emitDeviceFlowStatus({ status: 'error', error: data.error_description || data.error });
          return;
        }
      } catch {
        // Network error — continue polling
      }
    }

    this.emitDeviceFlowStatus({ status: 'expired' });
  }

  // --- Helpers ---

  private async fetchUserProfile(token: string): Promise<GitHubUser> {
    const fakePath = fakeRegistryPath();
    if (fakePath) {
      const registry = new FakeGitHubRegistry(fakePath);
      const account = registry.getAccountByToken(token);
      if (!account) {
        throw new AuthError('Fake GitHub registry rejected token');
      }
      return {
        login: account.login,
        name: account.name,
        avatarUrl: account.avatarUrl,
        email: `${account.login}@test.local`,
      };
    }

    let res: Response;
    try {
      res = await fetch(USER_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });
    } catch (e) {
      throw new NetworkError(
        `Network error contacting GitHub: ${e instanceof Error ? e.message : String(e)}`,
      );
    }

    if (res.status === 401 || res.status === 403) {
      throw new AuthError(`GitHub rejected token (${res.status})`);
    }
    if (!res.ok) {
      throw new NetworkError(`GitHub returned ${res.status}`);
    }

    const data = await res.json();
    return {
      login: data.login,
      name: data.name,
      avatarUrl: data.avatar_url,
      email: data.email,
    };
  }

  async logout(): Promise<void> {
    this.pollingAbort?.abort();
    // Remove only the active account
    const store = this.readStore();
    if (store.activeLogin) {
      this.removeAccount(store.activeLogin);
    } else {
      // Fallback: clear everything
      try {
        if (fs.existsSync(this.storePath)) {
          fs.unlinkSync(this.storePath);
        }
      } catch { /* ignore */ }
      this.emitAuthUpdate(null);
    }
  }

  private encryptToken(token: string): string {
    // E2E fake GitHub mode: tests pre-seed auth.json with plain-base64 tokens
    // from outside Electron, so they can't safeStorage-encrypt. Round-trip in
    // the same encoding here to avoid evicting seeded accounts on first decrypt.
    if (fakeRegistryPath()) {
      return Buffer.from(token).toString('base64');
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64');
    }
    return Buffer.from(token).toString('base64');
  }

  private decryptToken(encrypted: string): string {
    if (fakeRegistryPath()) {
      return Buffer.from(encrypted, 'base64').toString('utf-8');
    }
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
}
