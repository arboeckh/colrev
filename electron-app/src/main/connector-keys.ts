import * as fs from 'fs';
import * as path from 'path';

/**
 * API keys for search connectors (today: OpenAlex), kept across app and
 * backend restarts.
 *
 * The Python backend holds a key only in its process environment, so it is
 * lost whenever the process restarts. The main process keeps the keys here,
 * encrypted with the OS keychain (Electron `safeStorage`), in the app's
 * userData directory — never in a project repository — and sends them to every
 * fresh backend process (see `ColrevBackendOptions.handshakeCalls`).
 */

/** The slice of Electron's `safeStorage` this store needs; tests pass a fake. */
export interface SecretCipher {
  isEncryptionAvailable(): boolean;
  encryptString(plain: string): Buffer;
  decryptString(encrypted: Buffer): string;
}

interface StoredKeys {
  version: 1;
  /** connector -> base64 of the encrypted key */
  keys: Record<string, string>;
}

export class ConnectorKeyStore {
  constructor(
    private readonly filePath: string,
    private readonly cipher: SecretCipher,
  ) {}

  /**
   * Remember a key. Returns false, and stores nothing, when the OS offers no
   * encryption: a secret is never written in the clear.
   */
  set(connector: string, apiKey: string): boolean {
    if (!this.cipher.isEncryptionAvailable()) return false;
    const stored = this.read();
    stored.keys[connector] = this.cipher.encryptString(apiKey).toString('base64');
    this.write(stored);
    return true;
  }

  /** Every stored key that can still be decrypted, by connector. */
  all(): Record<string, string> {
    if (!this.cipher.isEncryptionAvailable()) return {};
    const out: Record<string, string> = {};
    for (const [connector, encrypted] of Object.entries(this.read().keys)) {
      try {
        out[connector] = this.cipher.decryptString(Buffer.from(encrypted, 'base64'));
      } catch {
        // Encrypted under another keychain: unusable, the user re-enters it.
      }
    }
    return out;
  }

  /** The RPCs that hand every stored key to a fresh backend process. */
  handshakeCalls(): Array<{ method: string; params: Record<string, unknown> }> {
    return Object.entries(this.all()).map(([connector, apiKey]) => ({
      method: 'set_connector_api_key',
      params: { connector, api_key: apiKey },
    }));
  }

  /** Remember the key of a successful `set_connector_api_key` call. */
  rememberFromRpc(method: string, params: Record<string, unknown>): void {
    if (method !== 'set_connector_api_key') return;
    const connector = String(params.connector ?? '')
      .trim()
      .toLowerCase();
    const apiKey = String(params.api_key ?? '').trim();
    if (connector && apiKey) this.set(connector, apiKey);
  }

  private read(): StoredKeys {
    try {
      const parsed = JSON.parse(fs.readFileSync(this.filePath, 'utf-8')) as StoredKeys;
      if (parsed?.version === 1 && parsed.keys && typeof parsed.keys === 'object') return parsed;
    } catch {
      // missing or unreadable: start empty
    }
    return { version: 1, keys: {} };
  }

  private write(stored: StoredKeys): void {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(stored), { mode: 0o600 });
  }
}
