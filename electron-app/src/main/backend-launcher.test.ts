import { describe, it, expect } from 'vitest';
import * as path from 'path';
import { resolveBackendLaunch, type BackendLaunchInput } from './backend-launcher';

function input(overrides: Partial<BackendLaunchInput> = {}): BackendLaunchInput {
  return {
    isPackaged: false,
    platform: 'darwin',
    resourcesPath: '/app/Resources',
    gitEnv: { PATH: '/usr/bin', LOCAL_GIT_DIRECTORY: '/git' },
    userDataDir: '/userData',
    env: {},
    ...overrides,
  };
}

describe('resolveBackendLaunch', () => {
  it('runs the module against PATH python in dev', () => {
    expect(resolveBackendLaunch(input())).toMatchObject({
      command: 'python',
      args: ['-m', 'colrev.ui_jsonrpc.server'],
    });
    expect(resolveBackendLaunch(input({ platform: 'win32' })).command).toBe('python.exe');
  });

  it('spawns the bundled shim when packaged, and puts its bin dir first on PATH', () => {
    const spec = resolveBackendLaunch(input({ isPackaged: true }));
    const binDir = path.join('/app/Resources', 'python-mac-arm64', 'bin');
    expect(spec.command).toBe(path.join(binDir, 'colrev-jsonrpc'));
    expect(spec.args).toEqual([]);
    expect(spec.env.PATH.split(path.delimiter)[0]).toBe(binDir);
  });

  it('uses the Windows bundle layout when packaged for win32', () => {
    const spec = resolveBackendLaunch(input({ isPackaged: true, platform: 'win32' }));
    const binDir = path.join('/app/Resources', 'python-win-x64', 'Scripts');
    expect(spec.command).toBe(path.join(binDir, 'colrev-jsonrpc.cmd'));
  });

  it('leaves PATH untouched in dev — there is no bundle to prepend', () => {
    expect(resolveBackendLaunch(input()).env.PATH).toBe('/usr/bin');
  });

  it('pins commit dates only when the e2e flag is set', () => {
    expect(resolveBackendLaunch(input()).env.GIT_AUTHOR_DATE).toBeUndefined();
    const pinned = resolveBackendLaunch(
      input({ env: { COLREV_E2E_PINNED_DATES: '1' } }),
    ).env;
    expect(pinned.GIT_AUTHOR_DATE).toBe(pinned.GIT_COMMITTER_DATE);
    expect(pinned.GIT_AUTHOR_DATE).toBeTruthy();
  });

  it('redirects HOME into the workspace only under the fake GitHub registry', () => {
    expect(resolveBackendLaunch(input()).env.HOME).toBeUndefined();
    expect(
      resolveBackendLaunch(input({ env: { COLREV_FAKE_GITHUB_REGISTRY: '/ws/registry.json' } }))
        .env.HOME,
    ).toBe('/userData');
  });
});
