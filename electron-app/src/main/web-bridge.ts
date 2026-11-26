import * as http from 'http';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import type { IpcHandler } from './ipc/registry';

/**
 * The web bridge: the renderer's IPC over HTTP, so the app can be used from a
 * browser while the main process and the Python backend run on another machine
 * (the agentixxx preview, scripts/agentixxx/preview.sh).
 *
 * In the browser, renderer/lib/web-bridge.ts defines the same `window.*` APIs
 * the preload does, on top of these routes (all under `/__bridge`, which the
 * renderer's Vite dev server proxies here):
 *
 * - `POST /invoke` `{channel, args}`: runs the handler registered for the
 *   channel, as `ipcRenderer.invoke` would. Always 200 with
 *   `{ok: true, value}` or `{ok: false, error: {message}}`.
 * - `GET /events`: server-sent events, one `{channel, args}` per
 *   `webContents.send` the main process makes.
 * - `GET /pdf/<projectId>/<path…>`: what the `colrev-pdf://` protocol serves.
 * - `POST /upload?name=<file name>` (raw body) and `POST /save-path`
 *   `{defaultName}`: paths in the bridge's transfer directory, standing in for
 *   the native open and save dialogs; `GET /download?path=<path>` hands a file
 *   written there to the browser.
 *
 * It listens on localhost only: whatever exposes the preview is in front of it.
 * That may be anyone with the preview's link, so the channels in
 * `MAIN_PROCESS_ONLY` are never registered here: the GitHub token stays on
 * this machine, and the renderer has no use for it.
 */

export interface WebBridgeOptions {
  port: number;
  host?: string;
  /** Resolve a project-relative PDF path, or null when it is out of bounds. */
  resolvePdf: (projectId: string, relativePath: string) => string | null;
  /** Where uploads land and saves are written. Created on demand. */
  transferDir: string;
}

/** Channels the bridge refuses: secrets a browser must never receive. */
const MAIN_PROCESS_ONLY = new Set(['auth:get-token']);

const MAX_UPLOAD_BYTES = 2 * 1024 ** 3;
const HEARTBEAT_MS = 15_000;

const CONTENT_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.csv': 'text/csv; charset=utf-8',
  '.bib': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

// Handlers receive the Electron event as their first argument; none of ours
// read it, and there is no WebContents behind a browser.
const BRIDGE_EVENT = { sender: null } as unknown as Electron.IpcMainInvokeEvent;

export class WebBridge {
  private readonly handlers = new Map<string, IpcHandler>();
  private readonly clients = new Set<http.ServerResponse>();
  private server: http.Server | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(private readonly options: WebBridgeOptions) {}

  register(channel: string, handler: IpcHandler): void {
    if (MAIN_PROCESS_ONLY.has(channel)) return;
    this.handlers.set(channel, handler);
  }

  broadcast(channel: string, ...args: unknown[]): void {
    if (this.clients.size === 0) return;
    let payload: string;
    try {
      payload = `data: ${JSON.stringify({ channel, args })}\n\n`;
    } catch (err) {
      console.warn(`[web-bridge] could not serialize "${channel}":`, err);
      return;
    }
    for (const res of this.clients) res.write(payload);
  }

  listen(): Promise<number> {
    const server = http.createServer((req, res) => {
      this.route(req, res).catch((err) => {
        console.error('[web-bridge] request failed:', err);
        if (!res.headersSent) sendJson(res, 500, { error: String(err) });
        else res.end();
      });
    });
    this.server = server;
    this.heartbeat = setInterval(() => {
      for (const res of this.clients) res.write(': ping\n\n');
    }, HEARTBEAT_MS);
    return new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.options.port, this.options.host ?? '127.0.0.1', () => {
        const address = server.address();
        resolve(typeof address === 'object' && address ? address.port : this.options.port);
      });
    });
  }

  close(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat);
    for (const res of this.clients) res.end();
    this.clients.clear();
    const server = this.server;
    this.server = null;
    return new Promise((resolve) => (server ? server.close(() => resolve()) : resolve()));
  }

  private async route(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? '/', 'http://bridge');
    const route = url.pathname.replace(/^\/__bridge/, '');

    if (req.method === 'POST' && route === '/invoke') return this.invoke(req, res);
    if (req.method === 'GET' && route === '/events') return this.events(req, res);
    if (req.method === 'GET' && route.startsWith('/pdf/')) return this.pdf(route, res);
    if (req.method === 'POST' && route === '/upload') return this.upload(req, url, res);
    if (req.method === 'POST' && route === '/save-path') return this.savePath(req, res);
    if (req.method === 'GET' && route === '/download') return this.download(url, res);
    sendJson(res, 404, { error: 'Not found' });
  }

  private async invoke(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = JSON.parse((await readBody(req, 64 * 1024 ** 2)).toString('utf-8')) as {
      channel?: unknown;
      args?: unknown;
    };
    const channel = typeof body.channel === 'string' ? body.channel : '';
    const args = Array.isArray(body.args) ? body.args : [];
    const handler = this.handlers.get(channel);
    if (!handler) {
      sendJson(res, 200, {
        ok: false,
        error: { message: `No handler registered for '${channel}'` },
      });
      return;
    }
    try {
      const value = await handler(BRIDGE_EVENT, ...args);
      // An undefined value drops out of the JSON and arrives as undefined, as over IPC.
      sendJson(res, 200, { ok: true, value });
    } catch (err) {
      // The message ipcRenderer.invoke rejects with, so the renderer sees the same text.
      const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      sendJson(res, 200, {
        ok: false,
        error: { message: `Error invoking remote method '${channel}': ${message}` },
      });
    }
  }

  private events(req: http.IncomingMessage, res: http.ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // nginx-style proxies buffer responses unless told not to.
      'X-Accel-Buffering': 'no',
    });
    res.write(': connected\n\n');
    this.clients.add(res);
    req.on('close', () => this.clients.delete(res));
  }

  private pdf(route: string, res: http.ServerResponse): void {
    const parts = route.slice('/pdf/'.length).split('/').filter(Boolean);
    if (parts.length < 2) {
      sendJson(res, 400, { error: 'Invalid PDF URL' });
      return;
    }
    const projectId = decodeURIComponent(parts[0]);
    const relativePath = parts.slice(1).map(decodeURIComponent).join('/');
    const filePath = this.options.resolvePdf(projectId, relativePath);
    if (!filePath) {
      sendJson(res, 403, { error: 'Access denied' });
      return;
    }
    sendFile(res, filePath, 'inline');
  }

  private async upload(
    req: http.IncomingMessage,
    url: URL,
    res: http.ServerResponse,
  ): Promise<void> {
    const filePath = this.newTransferPath(url.searchParams.get('name') ?? 'upload');
    await new Promise<void>((resolve, reject) => {
      let received = 0;
      const out = fs.createWriteStream(filePath);
      req.on('data', (chunk: Buffer) => {
        received += chunk.length;
        if (received > MAX_UPLOAD_BYTES) {
          req.destroy();
          out.destroy();
          reject(new Error('Upload too large'));
        }
      });
      req.pipe(out);
      out.on('finish', resolve);
      out.on('error', reject);
      req.on('error', reject);
    });
    sendJson(res, 200, { filePath });
  }

  private async savePath(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf-8')) as {
      defaultName?: unknown;
    };
    const name = typeof body.defaultName === 'string' ? body.defaultName : 'download';
    sendJson(res, 200, { filePath: this.newTransferPath(name) });
  }

  private download(url: URL, res: http.ServerResponse): void {
    const requested = url.searchParams.get('path') ?? '';
    const root = path.resolve(this.options.transferDir);
    const filePath = path.resolve(requested);
    // Only what the bridge itself handed out: never an arbitrary path on the machine.
    if (!filePath.startsWith(root + path.sep)) {
      sendJson(res, 403, { error: 'Access denied' });
      return;
    }
    sendFile(res, filePath, 'attachment');
  }

  /** A fresh path in the transfer directory that keeps the file's own name. */
  private newTransferPath(name: string): string {
    const dir = path.join(this.options.transferDir, randomUUID());
    fs.mkdirSync(dir, { recursive: true });
    const base = path.basename(name).replace(/[\\/:*?"<>|\0]/g, '_') || 'file';
    return path.join(dir, base);
  }
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(text),
    'Cache-Control': 'no-store',
  });
  res.end(text);
}

function sendFile(
  res: http.ServerResponse,
  filePath: string,
  disposition: 'inline' | 'attachment',
): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(filePath);
  } catch {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  if (!stat.isFile()) {
    sendJson(res, 404, { error: 'Not found' });
    return;
  }
  const name = path.basename(filePath);
  res.writeHead(200, {
    'Content-Type':
      CONTENT_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': stat.size,
    'Content-Disposition': `${disposition}; filename*=UTF-8''${encodeURIComponent(name)}`,
    'Cache-Control': 'no-store',
  });
  fs.createReadStream(filePath).pipe(res);
}

function readBody(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        req.destroy();
        reject(new Error('Request body too large'));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}
