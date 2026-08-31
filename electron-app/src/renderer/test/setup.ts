/**
 * Global setup for the `dom` vitest project (WP-08 §1).
 *
 * happy-dom implements most of what the renderer touches, but not the two
 * browser APIs our component tree assumes exist: `matchMedia` (theme store)
 * and `ResizeObserver` (reka-ui popovers/tooltips). Stub them once here so no
 * individual test has to.
 */
import { afterEach, vi } from 'vitest';
import { uninstallWindowMock } from './window-mock';

if (!window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
}

afterEach(() => {
  uninstallWindowMock();
  localStorage.clear();
});
