/**
 * Ad-hoc playwright probe: launches the built electron app against the
 * user's real user-data-dir, navigates to whatever page they last had,
 * and instruments the apply_reconciliation RPC so we can see the request
 * params and response when the user clicks Override.
 *
 * Prereq: close the running `electron-vite dev` electron first (two
 * instances can't share user-data-dir).
 *
 * Run:  npx tsx scripts/adhoc/inspect-reconcile.ts
 */

import { _electron as electron } from 'playwright';
import * as path from 'path';
import * as os from 'os';

const APP_PATH = path.join(__dirname, '..', '..', 'dist', 'main', 'index.js');
const USER_DATA_DIR = path.join(
  os.homedir(),
  'Library',
  'Application Support',
  'colrev',
);

async function main() {
  console.log(`[probe] launching ${APP_PATH}`);
  console.log(`[probe] user-data-dir: ${USER_DATA_DIR}`);

  // NODE_ENV must NOT be 'development' (that makes the main process try to
  // load http://localhost:5173, the vite dev server). We're loading the built
  // renderer from dist/. Python path is gated on app.isPackaged separately,
  // and that's false here, so the backend still spawns `python -m
  // colrev.ui_jsonrpc.server` from PATH (your venv).
  const env: Record<string, string> = { ...(process.env as Record<string, string>) };
  delete env.NODE_ENV;

  const app = await electron.launch({
    args: [APP_PATH, `--user-data-dir=${USER_DATA_DIR}`],
    env,
  });

  const win = await app.firstWindow();
  await win.waitForLoadState('domcontentloaded');

  // Pipe renderer console + page errors to our terminal.
  win.on('console', (msg) => {
    console.log(`[renderer:${msg.type()}] ${msg.text()}`);
  });
  win.on('pageerror', (err) => {
    console.log(`[renderer:error] ${err.stack ?? err.message}`);
  });

  // Patch window.confirm/alert so they don't silently no-op (Electron blocks
  // them from web contents by default, returning false with no UI). Also
  // instrument window.colrev.call so we see every RPC.
  await win.evaluate(() => {
    const origConfirm = window.confirm;
    window.confirm = (msg?: string) => {
      console.log(`[probe] window.confirm called: ${msg}`);
      try {
        const r = origConfirm.call(window, msg);
        console.log(`[probe] window.confirm native -> ${r}`);
        return true; // force-accept regardless
      } catch (e) {
        console.log(`[probe] window.confirm threw: ${e instanceof Error ? e.message : String(e)} -> forcing true`);
        return true;
      }
    };
    const origAlert = window.alert;
    window.alert = (msg?: string) => {
      console.log(`[probe] window.alert called: ${msg}`);
      try { origAlert.call(window, msg); } catch {}
    };
    console.log('[probe] window.confirm/alert patched');
  });

  await win.evaluate(() => {
    type ColrevBridge = {
      call: (method: string, params: Record<string, unknown>) => Promise<unknown>;
    };
    const w = window as unknown as { colrev: ColrevBridge };
    if (!w.colrev) {
      console.log('[probe] no window.colrev yet');
      return;
    }
    const original = w.colrev.call.bind(w.colrev);
    w.colrev.call = async (method: string, params: Record<string, unknown>) => {
      const id = Math.random().toString(36).slice(2, 8);
      console.log(
        `[rpc.req ${id}] ${method} ${JSON.stringify(params).slice(0, 800)}`,
      );
      try {
        const result = await original(method, params);
        console.log(
          `[rpc.ok  ${id}] ${method} -> ${JSON.stringify(result).slice(0, 800)}`,
        );
        return result;
      } catch (err) {
        console.log(
          `[rpc.err ${id}] ${method} -> ${err instanceof Error ? err.message : String(err)}`,
        );
        throw err;
      }
    };
    console.log('[probe] window.colrev.call instrumented');
  });

  console.log('[probe] window ready. Drive the app manually; RPC will be logged here.');
  console.log('[probe] press Ctrl+C in this terminal to quit.');

  // Stay alive; user drives the app.
  await new Promise(() => {});
}

main().catch((err) => {
  console.error('[probe] failed:', err);
  process.exit(1);
});
