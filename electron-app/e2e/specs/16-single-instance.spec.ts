/**
 * Single-instance lock: a second app started with the same user-data dir
 * exits (it would run a second backend against the same repos and race on
 * auth.json); one started with a different user-data dir runs alongside it
 * (what dev:alice / dev:bob and the other specs rely on).
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { spawn } from 'child_process';
import { _electron as electron } from '@playwright/test';
import { test, expect } from '../fixtures/test-workspace.fixture';
import { resolveLaunchTarget } from '../helpers/launch-target';

function electronBinary(): string {
  const target = resolveLaunchTarget();
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return target.executablePath ?? (require('electron') as unknown as string);
}

test.describe('single instance', () => {
  test('a second instance with the same user-data dir exits', async ({ workspace, electronApp }) => {
    // The first instance is running (the fixture waits for its process).
    await electronApp.firstWindow();
    const target = resolveLaunchTarget();

    const second = spawn(
      electronBinary(),
      [...target.args, `--user-data-dir=${workspace.userDataDir}`],
      { stdio: 'ignore', env: { ...process.env, COLREV_BACKGROUND: '1' } },
    );
    const exitCode = await new Promise<number | null>((resolve, reject) => {
      const timer = setTimeout(() => {
        second.kill();
        reject(new Error('second instance did not exit'));
      }, 30_000);
      second.on('exit', (code) => {
        clearTimeout(timer);
        resolve(code);
      });
    });
    expect(exitCode).toBe(0);

    // The first one is untouched.
    expect(electronApp.windows().length).toBeGreaterThan(0);
  });

  test('an instance with a different user-data dir starts', async ({ electronApp }) => {
    await electronApp.firstWindow();
    const target = resolveLaunchTarget();
    const otherDir = fs.mkdtempSync(path.join(os.tmpdir(), 'colrev-second-ud-'));
    const other = await electron.launch({
      ...(target.executablePath ? { executablePath: target.executablePath } : {}),
      args: [...target.args, `--user-data-dir=${otherDir}`],
      env: { ...process.env, NODE_ENV: 'production' } as Record<string, string>,
    });
    try {
      const window = await other.firstWindow();
      expect(window).toBeTruthy();
    } finally {
      await other.close().catch(() => {});
      fs.rmSync(otherDir, { recursive: true, force: true });
    }
  });
});
