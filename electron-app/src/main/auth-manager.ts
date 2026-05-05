import { app, safeStorage } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const GITHUB_CLIENT_ID = 'Ov23li8l88sQbgmXSvgc';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const SCOPES = 'read:user repo workflow';

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

    try {
      const token = this.decryptToken(account.encryptedToken);
      const user = await this.fetchUserProfile(token);
      if (!user) {
        // Token invalid — remove this account
        this.removeAccount(account.user.login);
        return null;
      }
      return { user, authenticatedAt: account.authenticatedAt };
    } catch {
      this.removeAccount(account.user.login);
      return null;
    }
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
    const account = store.accounts.find((a) => a.user.login === store.activeLogin);
    return account ? account.user.login : null;
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

    // Validate the token is still good
    try {
      const token = this.decryptToken(account.encryptedToken);
      const user = await this.fetchUserProfile(token);
      if (!user) {
        this.removeAccount(login);
        return null;
      }

      // Update active login
      store.activeLogin = login;
      // Refresh user profile data
      account.user = user;
      this.writeStore(store);

      const session: AuthSession = { user, authenticatedAt: account.authenticatedAt };
      this.emitAuthUpdate(session);
      return session;
    } catch {
      this.removeAccount(login);
      return null;
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
          const user = await this.fetchUserProfile(data.access_token);
          if (!user) {
            this.emitDeviceFlowStatus({ status: 'error', error: 'Failed to fetch user profile' });
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

  private async fetchUserProfile(token: string): Promise<GitHubUser | null> {
    try {
      const res = await fetch(USER_URL, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
        },
      });

      if (!res.ok) return null;

      const data = await res.json();
      return {
        login: data.login,
        name: data.name,
        avatarUrl: data.avatar_url,
        email: data.email,
      };
    } catch {
      return null;
    }
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
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64');
    }
    return Buffer.from(token).toString('base64');
  }

  private decryptToken(encrypted: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
}
