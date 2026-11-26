/**
 * Preview mode (COLREV_PREVIEW=1), for the agentixxx preview (scripts/agentixxx/preview.sh): the
 * app runs on a VNC display that a page in the viewer's browser (scripts/agentixxx/preview/
 * index.html) sizes to the browser window, with no window manager.
 *
 * - The window covers the primary display and follows it, since maximize() does nothing there,
 *   and its menu bar is hidden.
 * - The page tells the app the scale it shows the display at (display pixels per CSS pixel of the
 *   viewer's window, their screen's devicePixelRatio within a pixel budget), as lines `scale <n>`
 *   on a TCP socket (COLREV_PREVIEW_CONTROL_PORT) that websockify bridges to the page. The app
 *   zooms to it: Electron's device scale factor is fixed at launch, so the zoom makes up the
 *   difference, and the app is laid out for the viewer's window and rendered at their screen's
 *   density.
 * - Animations and transitions are off: each of their frames is sent over the network, and an
 *   overlay that fades changes the whole screen in every one.
 */
import { createServer, type Server } from 'net';
import { screen, type BrowserWindow } from 'electron';

const NO_MOTION_CSS = `*, *::before, *::after {
  animation-duration: 0s !important; animation-delay: 0s !important;
  transition-duration: 0s !important; transition-delay: 0s !important;
  scroll-behavior: auto !important;
}`;

/** The lowest and highest scale taken from the page; anything else is ignored. */
const MIN_SCALE = 0.5;
const MAX_SCALE = 4;

/**
 * The scale a line of the control socket asks for, or null for a line that is not `scale <n>`
 * with n in [MIN_SCALE, MAX_SCALE].
 */
export function parseScaleLine(line: string): number | null {
  const match = /^scale (\d+(?:\.\d+)?)$/.exec(line.trim());
  if (match === null) return null;
  const scale = Number(match[1]);
  return scale >= MIN_SCALE && scale <= MAX_SCALE ? scale : null;
}

/** The zoom factor that renders at `scale` on a display of `deviceScaleFactor`. */
export function zoomFor(scale: number, deviceScaleFactor: number): number {
  return scale / (deviceScaleFactor > 0 ? deviceScaleFactor : 1);
}

/** Puts `win` in preview mode; returns what undoes it, which closing the window also does. */
export function attachPreviewDisplay(win: BrowserWindow, controlPort: number | null): () => void {
  let scale: number | null = null;

  const fit = () => {
    if (!win.isDestroyed()) win.setBounds(screen.getPrimaryDisplay().bounds);
  };
  const applyZoom = () => {
    if (scale === null || win.isDestroyed()) return;
    win.webContents.setZoomFactor(zoomFor(scale, screen.getPrimaryDisplay().scaleFactor));
  };
  const onLoad = () => {
    win.webContents.insertCSS(NO_MOTION_CSS).catch(() => undefined);
    applyZoom();
  };

  // GTK draws the menu bar at the device scale factor, which the zoom does not reach; Alt shows it.
  win.setAutoHideMenuBar(true);
  win.setMenuBarVisibility(false);
  fit();
  const events = ['display-metrics-changed', 'display-added', 'display-removed'] as const;
  for (const event of events) screen.on(event as 'display-added', fit);
  win.webContents.on('dom-ready', onLoad);

  let server: Server | null = null;
  if (controlPort !== null) {
    server = createServer((socket) => {
      let buffered = '';
      socket.setEncoding('utf8');
      socket.on('data', (chunk: string) => {
        buffered += chunk;
        let newline: number;
        while ((newline = buffered.indexOf('\n')) >= 0) {
          const asked = parseScaleLine(buffered.slice(0, newline));
          buffered = buffered.slice(newline + 1);
          if (asked !== null) {
            scale = asked;
            applyZoom();
          }
        }
        if (buffered.length > 1024) buffered = '';
      });
      socket.on('error', () => undefined);
    });
    server.on('error', (err) => console.error('[preview] control socket:', err.message));
    server.listen(controlPort, '127.0.0.1');
  }

  const detach = () => {
    for (const event of events) screen.off(event as 'display-added', fit);
    server?.close();
    server = null;
  };
  win.on('closed', detach);
  return detach;
}
