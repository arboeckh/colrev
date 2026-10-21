/**
 * Real-client-only behaviour of `createRepoAndPush` that the shared contract
 * suite cannot express: the fake has no GitHub Actions to turn off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { exec } from 'dugite';
import { createRepoAndPush } from './github-manager';

vi.mock('dugite', () => ({ exec: vi.fn() }));

const ACTIONS_URL = 'https://api.github.com/repos/alice/lit-review/actions/permissions';

describe('createRepoAndPush: GitHub Actions', () => {
  const calls: string[] = [];
  let actionsStatus = 204;

  beforeEach(() => {
    calls.length = 0;
    actionsStatus = 204;
    vi.spyOn(console, 'warn').mockImplementation(() => {});

    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: { method?: string; body?: string }) => {
        const method = init?.method ?? 'GET';
        calls.push(`${method} ${url}`);
        if (url === ACTIONS_URL) {
          expect(JSON.parse(init?.body ?? '{}')).toEqual({ enabled: false });
          return { ok: actionsStatus < 300, status: actionsStatus, json: async () => ({}) };
        }
        const body =
          url === 'https://api.github.com/user'
            ? { login: 'alice' }
            : { html_url: 'https://github.com/alice/lit-review' };
        return { ok: true, status: 200, json: async () => body };
      }),
    );

    vi.mocked(exec).mockImplementation((async (args: string[]) => {
      if (args.includes('push')) calls.push('git push');
      const stdout = args[0] === 'symbolic-ref' ? 'main\n' : '';
      return { stdout, stderr: '', exitCode: 0 };
    }) as unknown as typeof exec);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  const publish = () =>
    createRepoAndPush({
      token: 'tok',
      repoName: 'lit-review',
      projectPath: '/unused',
      isPrivate: true,
    });

  it('disables Actions on the new repo before the first push', async () => {
    const result = await publish();

    expect(result.success).toBe(true);
    const disableAt = calls.indexOf(`PUT ${ACTIONS_URL}`);
    expect(disableAt).toBeGreaterThan(-1);
    expect(disableAt).toBeLessThan(calls.indexOf('git push'));
  });

  it('still publishes when Actions cannot be disabled', async () => {
    actionsStatus = 403;

    const result = await publish();

    expect(result.success).toBe(true);
    expect(calls).toContain('git push');
  });
});
