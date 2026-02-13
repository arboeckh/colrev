import { app, safeStorage, shell } from 'electron';
import * as fs from 'fs';
import * as path from 'path';

const GITHUB_CLIENT_ID = 'Ov23li8l88sQbgmXSvgc';
const DEVICE_CODE_URL = 'https://github.com/login/device/code';
const TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_URL = 'https://api.github.com/user';
const SCOPES = 'read:user repo workflow';

interface StoredAuth {
  encryptedToken: string;
  user: GitHubUser;
  authenticatedAt: string;
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

  private readStore(): StoredAuth | null {
    try {
      if (fs.existsSync(this.storePath)) {
        return JSON.parse(fs.readFileSync(this.storePath, 'utf-8'));
      }
    } catch {
      // Corrupt file — ignore
    }
    return null;
  }

  private writeStore(data: StoredAuth): void {
    fs.writeFileSync(this.storePath, JSON.stringify(data), 'utf-8');
  }

  private deleteStore(): void {
    try {
      if (fs.existsSync(this.storePath)) {
        fs.unlinkSync(this.storePath);
      }
    } catch {
      // Ignore
    }
  }

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

  async getSession(): Promise<AuthSession | null> {
    const stored = this.readStore();
    if (!stored) return null;

    try {
      const token = this.decryptToken(stored.encryptedToken);
      // Validate token is still good
      const user = await this.fetchUserProfile(token);
      if (!user) {
        this.deleteStore();
        return null;
      }
      return { user, authenticatedAt: stored.authenticatedAt };
    } catch {
      this.deleteStore();
      return null;
    }
  }

  getToken(): string | null {
    const stored = this.readStore();
    if (!stored) return null;
    try {
      return this.decryptToken(stored.encryptedToken);
    } catch {
      return null;
    }
  }

  async startDeviceFlow(): Promise<void> {
    // Abort any existing polling
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

      // Open browser for the user
      shell.openExternal(verification_uri);

      // Start polling
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

          this.writeStore({
            encryptedToken: this.encryptToken(data.access_token),
            user,
            authenticatedAt: session.authenticatedAt,
          });

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
    this.deleteStore();
    this.emitAuthUpdate(null);
  }

  private encryptToken(token: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.encryptString(token).toString('base64');
    }
    // Fallback: base64 only (less secure, but functional)
    return Buffer.from(token).toString('base64');
  }

  private decryptToken(encrypted: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
    }
    return Buffer.from(encrypted, 'base64').toString('utf-8');
  }
}
