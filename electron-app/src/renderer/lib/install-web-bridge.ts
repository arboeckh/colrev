// Imported first by main.ts, so the `window.*` APIs exist before any module reads them.
// Inside Electron the preload has defined them already and this does nothing.
import { installWebBridge } from './web-bridge';

if (!(window as { colrev?: unknown }).colrev) installWebBridge();
