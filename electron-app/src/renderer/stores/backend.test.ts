/**
 * The backend store: the renderer's single RPC funnel (WP-08 §1).
 *
 * Two things here are contract-derived rather than hand-maintained, and both
 * are worth pinning: which methods count as writers (read out of the
 * generated `rpc-schemas.json`, and load-bearing for the invalidation seam)
 * and the structured progress/lifecycle events the bridge pushes.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useBackendStore } from './backend';
import { useProjectDataStore } from './projectData';
import { RPC_ERROR_CODES, RpcError } from '@/lib/rpc-errors';
import rpcSchemas from '@/types/generated/rpc-schemas.json';
import {
  operationResponse,
  setupRendererTest,
  TEST_PROJECT_ID,
  type RendererTestContext,
} from '@/test/harness';

let ctx: RendererTestContext;

beforeEach(() => {
  ctx = setupRendererTest();
});

describe('start / stop lifecycle', () => {
  it('reads the projects path off appInfo once running', async () => {
    const backend = useBackendStore();
    await expect(backend.start()).resolves.toBe(true);
    expect(backend.isRunning).toBe(true);
    expect(backend.basePath).toBe('/projects');
  });

  it('records the failure reason when the backend refuses to start', async () => {
    ctx.mock.colrev.start = vi.fn(async () => ({ success: false, error: 'python missing' }));
    const backend = useBackendStore();

    await expect(backend.start()).resolves.toBe(false);
    expect(backend.status).toBe('error');
    expect(backend.error).toBe('python missing');
  });

  it('refuses calls while stopped', async () => {
    const backend = useBackendStore();
    await expect(backend.call('ping', {})).rejects.toThrow('Backend is not running');
  });
});

describe('call', () => {
  beforeEach(async () => {
    await useBackendStore().start();
  });

  it('sends base_path with every call and unwraps the envelope', async () => {
    const backend = useBackendStore();
    ctx.mock.rpc.on('ping', { status: 'pong' });

    await expect(backend.call('ping', {})).resolves.toEqual({ status: 'pong' });
    expect(ctx.mock.rpc.callsTo('ping')[0].params).toMatchObject({ base_path: '/projects' });
  });

  it('rethrows a failure envelope as a typed RpcError', async () => {
    const backend = useBackendStore();
    ctx.mock.rpc.onError('prescreen_record', {
      code: RPC_ERROR_CODES.PRECONDITION_FAILED,
      message: 'uncommitted changes',
    });

    const err = await backend
      .call('prescreen_record', { project_id: 'p', record_id: 'r', decision: 'include' })
      .catch((e: unknown) => e);

    expect(err).toBeInstanceOf(RpcError);
    expect((err as RpcError).code).toBe(RPC_ERROR_CODES.PRECONDITION_FAILED);
    expect((err as RpcError).method).toBe('prescreen_record');
  });

  it('answers an unstubbed method with METHOD_NOT_FOUND rather than undefined', async () => {
    const backend = useBackendStore();
    const err = await backend.call('get_sources', { project_id: 'p' }).catch((e: unknown) => e);
    expect((err as RpcError).code).toBe(RPC_ERROR_CODES.METHOD_NOT_FOUND);
  });
});

describe('writer detection (schema-derived)', () => {
  beforeEach(async () => {
    await useBackendStore().start();
    ctx.openProject();
  });

  it('agrees with the generated schema about what writes', () => {
    const methods = rpcSchemas.methods as Record<
      string,
      { writes?: boolean; requires_project?: boolean }
    >;
    // A guard against the schema regenerating into something shapeless: if
    // these ever go empty the tests below would pass vacuously.
    expect(Object.keys(methods).length).toBeGreaterThan(20);
    expect(methods.prescreen_record?.writes).toBe(true);
    expect(methods.get_prescreen_queue?.writes).toBe(false);
  });

  it('notifies the invalidation seam after a writer call', async () => {
    const backend = useBackendStore();
    const seam = useProjectDataStore();
    const notify = vi.spyOn(seam, 'notifyWriteCompleted');
    ctx.mock.rpc.on('prescreen_record', {
      success: true,
      project_id: TEST_PROJECT_ID,
      record: { id: 'r1', decision: 'include', new_status: 'rev_prescreen_included' },
      remaining_count: 0,
    });

    await backend.call('prescreen_record', {
      project_id: TEST_PROJECT_ID,
      record_id: 'r1',
      decision: 'include',
    });
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('prescreen_record'));
  });

  it('notifies the seam even when the writer failed — disk may already be dirty', async () => {
    const backend = useBackendStore();
    const seam = useProjectDataStore();
    const notify = vi.spyOn(seam, 'notifyWriteCompleted');
    ctx.mock.rpc.onError('commit_changes', { message: 'serialization blew up post-commit' });

    await backend
      .call('commit_changes', { project_id: TEST_PROJECT_ID, message: 'x' })
      .catch(() => {});
    await vi.waitFor(() => expect(notify).toHaveBeenCalledWith('commit_changes'));
  });

  it('does not notify the seam for a read', async () => {
    const backend = useBackendStore();
    const seam = useProjectDataStore();
    const notify = vi.spyOn(seam, 'notifyWriteCompleted');
    ctx.mock.rpc.on('get_prescreen_queue', {
      success: true,
      project_id: TEST_PROJECT_ID,
      records: [],
      total_count: 0,
    });

    await backend.call('get_prescreen_queue', { project_id: TEST_PROJECT_ID });
    expect(notify).not.toHaveBeenCalled();
  });

  it('exposes the running writer so a second trigger can be refused', async () => {
    const backend = useBackendStore();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    ctx.mock.rpc.on('prep', async () => {
      await gate;
      return operationResponse('prep');
    });

    const inFlight = backend.call('prep', { project_id: TEST_PROJECT_ID });
    await vi.waitFor(() => expect(backend.runningOperation?.method).toBe('prep'));

    release();
    await inFlight;
    expect(backend.runningOperation).toBeNull();
  });

  it('clears the running writer only when the last overlapping one finishes', async () => {
    const backend = useBackendStore();
    let releaseSlow!: () => void;
    const slow = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    ctx.mock.rpc
      .on('prep', async () => {
        await slow;
        return operationResponse('prep');
      })
      .on('dedupe', operationResponse('dedupe'));

    const first = backend.call('prep', { project_id: TEST_PROJECT_ID });
    const second = backend.call('dedupe', { project_id: TEST_PROJECT_ID });
    await second;

    expect(backend.runningOperation?.method).toBe('prep');
    releaseSlow();
    await first;
    expect(backend.runningOperation).toBeNull();
  });
});

describe('progress events', () => {
  beforeEach(async () => {
    await useBackendStore().start();
  });

  it('turns search progress into a batch/record view and notifies listeners', () => {
    const backend = useBackendStore();
    const seen: unknown[] = [];
    backend.onSearchProgress((p) => void seen.push(p));

    ctx.mock.emitProgress({
      kind: 'search_progress',
      message: '20/100 records',
      current: 20,
      total: 100,
    });

    expect(backend.searchProgress).toMatchObject({
      currentBatch: 20,
      totalBatches: 100,
      fetchedRecords: 20,
      totalRecords: 100,
      status: '20/100 records',
    });
    expect(seen).toHaveLength(1);
  });

  it('turns per-operation progress into a percentage', () => {
    const backend = useBackendStore();
    ctx.mock.emitProgress({
      kind: 'pdf_get_progress',
      message: 'fetching',
      current: 3,
      total: 4,
    });
    expect(backend.operationProgress).toBe(75);
  });

  it('ignores a total of zero rather than dividing by it', () => {
    const backend = useBackendStore();
    ctx.mock.emitProgress({
      kind: 'load_progress',
      message: 'starting',
      current: 0,
      total: 0,
    });
    expect(backend.operationProgress).toBeNull();
  });

  it('mirrors the serial RPC queue', () => {
    const backend = useBackendStore();
    ctx.mock.emitRpcQueue({
      inFlight: { method: 'search', startedAt: 1 },
      queued: ['get_status'],
    });
    expect(backend.rpcInFlight).toBe('search');
    expect(backend.rpcQueued).toEqual(['get_status']);
  });
});

describe('supervised restart', () => {
  beforeEach(async () => {
    await useBackendStore().start();
    ctx.openProject();
  });

  it('shows the restarting state, then invalidates everything once back', async () => {
    const backend = useBackendStore();
    const seam = useProjectDataStore();
    const invalidate = vi.spyOn(seam, 'invalidateAll');

    ctx.mock.emitRestarting({ attempt: 1, maxAttempts: 3, delayMs: 500 });
    expect(backend.status).toBe('restarting');

    ctx.mock.emitRestarted();
    expect(backend.status).toBe('running');
    // The new process has no memory of prior work — nothing on screen is trusted.
    await vi.waitFor(() => expect(invalidate).toHaveBeenCalled());
  });

  it('accepts calls while restarting (main queues them)', async () => {
    const backend = useBackendStore();
    ctx.mock.rpc.on('ping', { status: 'pong' });
    ctx.mock.emitRestarting({ attempt: 1, maxAttempts: 3, delayMs: 500 });

    await expect(backend.call('ping', {})).resolves.toEqual({ status: 'pong' });
  });

  it('goes to error when the supervisor gives up', () => {
    const backend = useBackendStore();
    ctx.mock.emitRestartFailed();
    expect(backend.status).toBe('error');
    expect(backend.error).toBe('Backend crashed and could not be restarted');
  });
});
