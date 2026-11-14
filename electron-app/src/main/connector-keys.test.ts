import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ConnectorKeyStore, type SecretCipher } from './connector-keys';

const fakeCipher = (available = true): SecretCipher => ({
  isEncryptionAvailable: () => available,
  encryptString: (plain) => Buffer.from(`enc:${plain}`),
  decryptString: (encrypted) => {
    const text = encrypted.toString();
    if (!text.startsWith('enc:')) throw new Error('wrong keychain');
    return text.slice(4);
  },
});

describe('ConnectorKeyStore', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'connector-keys-'));
    file = path.join(dir, 'connector-keys.json');
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('survives a new store on the same file (an app restart)', () => {
    new ConnectorKeyStore(file, fakeCipher()).set('openalex', 'secret-key');
    expect(new ConnectorKeyStore(file, fakeCipher()).all()).toEqual({ openalex: 'secret-key' });
  });

  it('never writes the key in the clear', () => {
    new ConnectorKeyStore(file, fakeCipher()).set('openalex', 'secret-key');
    expect(fs.readFileSync(file, 'utf-8')).not.toContain('secret-key');
  });

  it('stores nothing when the OS offers no encryption', () => {
    const store = new ConnectorKeyStore(file, fakeCipher(false));
    expect(store.set('openalex', 'secret-key')).toBe(false);
    expect(fs.existsSync(file)).toBe(false);
    expect(store.all()).toEqual({});
  });

  it('skips a key it cannot decrypt', () => {
    fs.writeFileSync(
      file,
      JSON.stringify({ version: 1, keys: { openalex: Buffer.from('foreign').toString('base64') } }),
    );
    expect(new ConnectorKeyStore(file, fakeCipher()).all()).toEqual({});
  });

  it('builds one set_connector_api_key call per stored key', () => {
    const store = new ConnectorKeyStore(file, fakeCipher());
    store.set('openalex', 'secret-key');
    expect(store.handshakeCalls()).toEqual([
      { method: 'set_connector_api_key', params: { connector: 'openalex', api_key: 'secret-key' } },
    ]);
  });

  it('remembers only set_connector_api_key calls', () => {
    const store = new ConnectorKeyStore(file, fakeCipher());
    store.rememberFromRpc('get_sources', { connector: 'openalex', api_key: 'nope' });
    store.rememberFromRpc('set_connector_api_key', { connector: ' OpenAlex ', api_key: ' k ' });
    expect(store.all()).toEqual({ openalex: 'k' });
  });
});
