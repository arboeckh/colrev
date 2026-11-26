import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { WebBridge } from './web-bridge';

let dir: string;
let bridge: WebBridge;
let base: string;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'web-bridge-'));
  fs.mkdirSync(path.join(dir, 'projects', 'p1', 'data', 'pdfs'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'projects', 'p1', 'data', 'pdfs', 'a b#1.pdf'), '%PDF-1.4 fake');
  fs.writeFileSync(path.join(dir, 'secret.txt'), 'secret');
  bridge = new WebBridge({
    port: 0,
    transferDir: path.join(dir, 'transfer'),
    resolvePdf: (projectId, relativePath) => {
      const root = path.join(dir, 'projects', projectId);
      const resolved = path.resolve(root, relativePath);
      return resolved.startsWith(root + path.sep) ? resolved : null;
    },
  });
  const port = await bridge.listen();
  base = `http://127.0.0.1:${port}/__bridge`;
});

afterEach(async () => {
  await bridge.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function invoke(channel: string, ...args: unknown[]) {
  const res = await fetch(`${base}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channel, args }),
  });
  return res.json();
}

describe('WebBridge /invoke', () => {
  it('runs the registered handler with the arguments and returns its value', async () => {
    bridge.register('math:add', async (_event, a: number, b: number) => a + b);
    expect(await invoke('math:add', 2, 3)).toEqual({ ok: true, value: 5 });
  });

  it('reports a thrown error with the text ipcRenderer.invoke rejects with', async () => {
    bridge.register('boom', async () => {
      throw new Error('nope');
    });
    expect(await invoke('boom')).toEqual({
      ok: false,
      error: { message: "Error invoking remote method 'boom': Error: nope" },
    });
  });

  it('refuses a channel nothing registered', async () => {
    expect(await invoke('missing')).toMatchObject({ ok: false });
  });

  it('never serves the GitHub token, even when its handler is registered', async () => {
    bridge.register('auth:get-token', async () => 'gho_secret');
    const response = await invoke('auth:get-token');
    expect(response).toMatchObject({ ok: false });
    expect(JSON.stringify(response)).not.toContain('gho_secret');
  });
});

describe('WebBridge /events', () => {
  it('streams each broadcast to connected clients', async () => {
    const controller = new AbortController();
    const res = await fetch(`${base}/events`, { signal: controller.signal });
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let text = '';
    // The connected comment arrives first; then broadcast and read until the event shows up.
    text += decoder.decode((await reader.read()).value);
    bridge.broadcast('colrev:log', 'hello');
    while (!text.includes('colrev:log')) text += decoder.decode((await reader.read()).value);
    const data = text.split('\n').find((line) => line.startsWith('data: '))!;
    expect(JSON.parse(data.slice('data: '.length))).toEqual({
      channel: 'colrev:log',
      args: ['hello'],
    });
    controller.abort();
  });
});

describe('WebBridge files', () => {
  it('serves a project PDF, with each path segment URL-encoded', async () => {
    const res = await fetch(`${base}/pdf/p1/data/pdfs/${encodeURIComponent('a b#1.pdf')}?v=2`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(await res.text()).toBe('%PDF-1.4 fake');
  });

  it('refuses a PDF path that leaves the project', async () => {
    const res = await fetch(`${base}/pdf/p1/${encodeURIComponent('../../secret.txt')}`);
    expect(res.status).toBe(403);
  });

  it('stores an upload in the transfer directory under its own base name', async () => {
    const res = await fetch(`${base}/upload?name=${encodeURIComponent('../evil.zip')}`, {
      method: 'POST',
      body: 'zip bytes',
    });
    const { filePath } = (await res.json()) as { filePath: string };
    expect(path.basename(filePath)).toBe('evil.zip');
    expect(filePath.startsWith(path.join(dir, 'transfer') + path.sep)).toBe(true);
    expect(fs.readFileSync(filePath, 'utf-8')).toBe('zip bytes');
  });

  it('downloads a file written to a path it handed out, and nothing else', async () => {
    const saved = await fetch(`${base}/save-path`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ defaultName: 'export.zip' }),
    });
    const { filePath } = (await saved.json()) as { filePath: string };
    fs.writeFileSync(filePath, 'exported');

    const ok = await fetch(`${base}/download?path=${encodeURIComponent(filePath)}`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toContain('attachment');
    expect(await ok.text()).toBe('exported');

    const outside = path.join(dir, 'secret.txt');
    const denied = await fetch(`${base}/download?path=${encodeURIComponent(outside)}`);
    expect(denied.status).toBe(403);
    const sneaky = path.join(dir, 'transfer', '..', 'secret.txt');
    const alsoDenied = await fetch(`${base}/download?path=${encodeURIComponent(sneaky)}`);
    expect(alsoDenied.status).toBe(403);
  });
});
