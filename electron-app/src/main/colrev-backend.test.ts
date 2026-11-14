/**
 * Unit tests for ColrevBackend (WP-02): queue order, crash rejection,
 * supervised restart, timeout classes, and RpcError mapping.
 *
 * ColrevBackend is pure Node — these tests spawn a fake JSON-RPC child
 * script instead of the real Python backend.
 */
import { describe, it, expect, beforeAll, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  ColrevBackend,
  BackendCrashedError,
  RpcError,
  RPC_TRANSPORT_CRASHED,
  RPC_TRANSPORT_STOPPED,
  RPC_TRANSPORT_TIMEOUT,
} from './colrev-backend';

const FAKE_SERVER_SOURCE = `
const fs = require('fs');
const readline = require('readline');

// If the control file exists, simulate a backend that can't start.
if (process.env.FAKE_DIE_FILE && fs.existsSync(process.env.FAKE_DIE_FILE)) {
  process.exit(1);
}

const rl = readline.createInterface({ input: process.stdin });
const respond = (obj) => process.stdout.write(JSON.stringify(obj) + '\\n');

rl.on('line', (line) => {
  let req;
  try {
    req = JSON.parse(line);
  } catch {
    return;
  }
  const { method, params, id } = req;
  switch (method) {
    case 'ping':
      respond({ jsonrpc: '2.0', result: { status: 'pong' }, id });
      break;
    case 'echo':
      respond({ jsonrpc: '2.0', result: params, id });
      break;
    case 'slow':
      setTimeout(
        () => respond({ jsonrpc: '2.0', result: { done: true }, id }),
        params.delayMs,
      );
      break;
    case 'progressive':
      respond({ jsonrpc: '2.0', method: 'progress', params: { kind: 'generic', message: 'working' } });
      respond({ jsonrpc: '2.0', result: { done: true }, id });
      break;
    case 'fail':
      respond({
        jsonrpc: '2.0',
        error: { code: -32005, message: 'precondition failed', data: 'CleanRepoRequiredError' },
        id,
      });
      break;
    case 'die':
      process.exit(1);
      break;
    case 'garbled':
      // What the real server does with a line it cannot parse: an error with
      // id null, and no response carrying this request's id.
      respond({ jsonrpc: '2.0', error: { code: -32700, message: 'Parse error' }, id: null });
      break;
    case 'writeSlowly':
      // A request that is mid-"write" when the app quits: the marker file only
      // appears if the process was allowed to finish.
      setTimeout(() => {
        fs.writeFileSync(params.marker, 'done');
        respond({ jsonrpc: '2.0', result: { done: true }, id });
      }, params.delayMs);
      break;
    case 'pid':
      respond({ jsonrpc: '2.0', result: { pid: process.pid }, id });
      break;
    case 'set_connector_api_key':
      process.env.FAKE_KEY = params.api_key;
      respond({ jsonrpc: '2.0', result: { configured: true }, id });
      break;
    case 'get_key':
      respond({ jsonrpc: '2.0', result: { key: process.env.FAKE_KEY ?? null }, id });
      break;
    default:
      respond({ jsonrpc: '2.0', error: { code: -32601, message: 'not found' }, id });
  }
});
`;

let scriptPath: string;
let dieFilePath: string;
let backend: ColrevBackend | null = null;

beforeAll(() => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-backend-test-'));
  scriptPath = path.join(dir, 'fake-jsonrpc-server.js');
  dieFilePath = path.join(dir, 'die-on-start');
  fs.writeFileSync(scriptPath, FAKE_SERVER_SOURCE);
});

afterEach(async () => {
  await backend?.stop();
  backend = null;
  fs.rmSync(dieFilePath, { force: true });
});

function makeBackend(opts: ConstructorParameters<typeof ColrevBackend>[3] = {}) {
  backend = new ColrevBackend(
    process.execPath,
    [scriptPath],
    { FAKE_DIE_FILE: dieFilePath },
    {
      restartDelaysMs: [50, 50, 50],
      startTimeoutMs: 5000,
      stopGraceMs: 200,
      ...opts,
    },
  );
  // 'error' events without a listener would throw.
  backend.on('error', () => {});
  return backend;
}

function once(emitter: ColrevBackend, event: string, timeoutMs = 5000): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for '${event}'`)),
      timeoutMs,
    );
    emitter.once(event, (arg: unknown) => {
      clearTimeout(timer);
      resolve(arg);
    });
  });
}

/** Await a promise that must reject; return its rejection as RpcError. */
async function expectRejection(p: Promise<unknown>): Promise<RpcError> {
  try {
    await p;
  } catch (e) {
    return e as RpcError;
  }
  throw new Error('Expected promise to reject');
}

describe('ColrevBackend', () => {
  it('starts and answers a call', async () => {
    const b = makeBackend();
    await b.start();
    const result = await b.call('echo', { hello: 'world' });
    expect(result).toEqual({ hello: 'world' });
  });

  it('maps wire errors to RpcError preserving code, data and method', async () => {
    const b = makeBackend();
    await b.start();
    const err = await expectRejection(b.call('fail', {}));
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(-32005);
    expect(err.data).toBe('CleanRepoRequiredError');
    expect(err.method).toBe('fail');
    expect(err.message).toBe('precondition failed');
  });

  it('processes requests strictly in order, one in flight', async () => {
    const b = makeBackend();
    await b.start();

    const first = b.call('slow', { delayMs: 150 });
    const second = b.call('echo', { n: 2 });

    // While the slow call runs, the queue is observable.
    const state = b.getQueueState();
    expect(state.inFlight?.method).toBe('slow');
    expect(state.queued).toEqual(['echo']);

    const order: string[] = [];
    await Promise.all([
      first.then(() => order.push('slow')),
      second.then(() => order.push('echo')),
    ]);
    expect(order).toEqual(['slow', 'echo']);
  });

  it('rejects all pending calls promptly with BackendCrashedError on crash', async () => {
    const b = makeBackend({ restartDelaysMs: [5000] });
    await b.start();

    const started = Date.now();
    const dying = b.call('die', {});
    const queued = b.call('echo', { n: 1 });

    const [err1, err2] = await Promise.all([
      expectRejection(dying),
      expectRejection(queued),
    ]);
    expect(Date.now() - started).toBeLessThan(1000);
    expect(err1).toBeInstanceOf(BackendCrashedError);
    expect(err1.code).toBe(RPC_TRANSPORT_CRASHED);
    expect(err2).toBeInstanceOf(BackendCrashedError);
  });

  it('restarts automatically after a crash; next RPC succeeds', async () => {
    const b = makeBackend();
    await b.start();

    const restarting = once(b, 'restarting');
    const restarted = once(b, 'restarted');
    await b.call('die', {}).catch(() => {});

    expect(await restarting).toMatchObject({ attempt: 1 });
    await restarted;

    const result = await b.call('echo', { after: 'restart' });
    expect(result).toEqual({ after: 'restart' });
  });

  it('queues calls made during the restart window and sends them once ready', async () => {
    const b = makeBackend();
    await b.start();

    const restarted = once(b, 'restarted');
    await b.call('die', {}).catch(() => {});

    // Backend process is gone; the supervisor is between attempts.
    const during = b.call('echo', { queued: 'during-restart' });
    await restarted;
    expect(await during).toEqual({ queued: 'during-restart' });
  });

  it('sends its handshake calls to every fresh process before any queued call', async () => {
    const b = makeBackend({
      handshakeCalls: () => [
        { method: 'set_connector_api_key', params: { connector: 'openalex', api_key: 'k-1' } },
      ],
    });
    await b.start();
    expect(await b.call('get_key', {})).toEqual({ key: 'k-1' });

    const restarted = once(b, 'restarted');
    await b.call('die', {}).catch(() => {});
    // Queued while the process is down: it must see the key of the new process.
    const during = b.call('get_key', {});
    await restarted;
    expect(await during).toEqual({ key: 'k-1' });
  });

  it('gives up after exhausting restart attempts and emits restart-failed', async () => {
    // No tight startTimeoutMs needed: the die-file makes every respawn exit
    // immediately, so each restart attempt fails fast on process close.
    const b = makeBackend({ restartDelaysMs: [30, 30] });
    await b.start();

    const failed = once(b, 'restart-failed', 10000);
    // Every respawn from now on dies immediately.
    fs.writeFileSync(dieFilePath, '');
    await b.call('die', {}).catch(() => {});
    await failed;

    const err = await expectRejection(b.call('echo', {}));
    expect(err).toBeInstanceOf(RpcError);
  });

  it('rejects pending calls with a stopped error on deliberate stop (no restart)', async () => {
    const b = makeBackend();
    await b.start();

    const pending = b.call('slow', { delayMs: 5000 });
    let sawRestarting = false;
    b.on('restarting', () => {
      sawRestarting = true;
    });
    const stopped = b.stop();

    const err = await expectRejection(pending);
    await stopped;
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(RPC_TRANSPORT_STOPPED);

    await new Promise((r) => setTimeout(r, 200));
    expect(sawRestarting).toBe(false);
  });

  it('whenTimedOutCallSettled waits for the late response of a timed-out call', async () => {
    const b = makeBackend({ timeoutClasses: { slow: 'fast' }, fastTimeoutMs: 100 });
    await b.start();

    // Nothing in flight: resolves at once.
    await b.whenTimedOutCallSettled();

    const err = await expectRejection(b.call('slow', { delayMs: 300 }));
    expect(err.code).toBe(RPC_TRANSPORT_TIMEOUT);

    // The caller was released, but the server is still running the request.
    let settled = false;
    const waiting = b.whenTimedOutCallSettled().then(() => (settled = true));
    await new Promise((r) => setTimeout(r, 30));
    expect(settled).toBe(false);

    await waiting;
    expect(settled).toBe(true);
  });

  it('caps fast methods, reconciles the late response, and keeps the queue moving', async () => {
    const b = makeBackend({
      timeoutClasses: { slow: 'fast' },
      fastTimeoutMs: 100,
    });
    await b.start();

    const late = once(b, 'late-response');
    const err = await expectRejection(b.call('slow', { delayMs: 300 }));
    expect(err).toBeInstanceOf(RpcError);
    expect(err.code).toBe(RPC_TRANSPORT_TIMEOUT);

    // The late response is surfaced, not silently dropped…
    expect(await late).toMatchObject({ method: 'slow', ok: true });
    // …and the pipe is usable again afterwards.
    expect(await b.call('echo', { n: 3 })).toEqual({ n: 3 });
  });

  it('does not cap slow methods (no timeout class)', async () => {
    const b = makeBackend({ fastTimeoutMs: 50 });
    await b.start();
    // 'slow' is not in the schema → defaults to the "slow" class → no cap.
    const result = await b.call('slow', { delayMs: 200 });
    expect(result).toEqual({ done: true });
  });

  it('forwards progress notifications emitted mid-request', async () => {
    const b = makeBackend();
    await b.start();
    const progress = once(b, 'progress');
    const result = await b.call('progressive', {});
    expect(result).toEqual({ done: true });
    expect(await progress).toMatchObject({ kind: 'generic', message: 'working' });
  });

  it('rejects an id-less error with the in-flight request and keeps the queue moving', async () => {
    const b = makeBackend();
    await b.start();

    const garbled = expectRejection(b.call('garbled', {}));
    const next = b.call('echo', { n: 4 });

    const err = await garbled;
    expect(err.code).toBe(-32700);
    expect(err.method).toBe('garbled');
    expect(await next).toEqual({ n: 4 });
    expect(b.getQueueState().inFlight).toBeNull();
  });

  it('ignores close/error events of a child that is no longer current', async () => {
    const b = makeBackend({ startTimeoutMs: 5000 });
    await b.start();
    const first = (b as unknown as { process: ChildProcessLike }).process;

    // Replace the child the way a supervised restart does: kill the old one,
    // spawn another. The old child's `close` arrives afterwards.
    (b as unknown as { killProcess(): void }).killProcess();
    await (b as unknown as { spawnAndWaitReady(): Promise<void> }).spawnAndWaitReady();
    const second = (b as unknown as { process: ChildProcessLike }).process;
    expect(second).not.toBe(first);

    const pending = b.call('slow', { delayMs: 300 });
    first.emit('close', 1);
    first.emit('error', new Error('late'));

    expect((b as unknown as { process: unknown }).process).toBe(second);
    expect(await pending).toEqual({ done: true });
    expect(await b.call('pid', {})).toMatchObject({ pid: second.pid });
  });

  it('does not throw when stdin fails (EPIPE) between the exit and its close event', async () => {
    const b = makeBackend({ restartDelaysMs: [5000] });
    await b.start();
    const child = (b as unknown as { process: ChildProcessLike }).process;

    const pending = expectRejection(b.call('slow', { delayMs: 5000 }));
    child.stdin!.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
    // Still alive and answering: the error was handled, not rethrown.
    child.kill();
    expect((await pending).code).toBe(RPC_TRANSPORT_CRASHED);
  });

  it('lets an in-flight request finish on stop, closing stdin first', async () => {
    const b = makeBackend({ stopGraceMs: 3000 });
    await b.start();
    const marker = path.join(path.dirname(scriptPath), 'marker-finish');
    fs.rmSync(marker, { force: true });

    const writing = b.call('writeSlowly', { delayMs: 150, marker });
    const queued = expectRejection(b.call('echo', { n: 1 }));
    const stopped = b.stop();

    expect(await writing).toEqual({ done: true });
    expect((await queued).code).toBe(RPC_TRANSPORT_STOPPED);
    await stopped;
    expect(fs.existsSync(marker)).toBe(true);
    expect(b.isRunning).toBe(false);
    expect((await expectRejection(b.call('echo', {}))).code).toBe(RPC_TRANSPORT_STOPPED);
  });

  it('kills the process when the in-flight request outlasts the grace period', async () => {
    const b = makeBackend({ stopGraceMs: 100 });
    await b.start();
    const marker = path.join(path.dirname(scriptPath), 'marker-killed');
    fs.rmSync(marker, { force: true });

    const writing = expectRejection(b.call('writeSlowly', { delayMs: 2000, marker }));
    const started = Date.now();
    await b.stop();

    expect((await writing).code).toBe(RPC_TRANSPORT_STOPPED);
    expect(Date.now() - started).toBeLessThan(1500);
    expect(fs.existsSync(marker)).toBe(false);
  });
});

type ChildProcessLike = import('child_process').ChildProcess;
