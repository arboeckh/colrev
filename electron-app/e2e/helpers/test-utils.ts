import { Page } from '@playwright/test';
import { DebugLogEntry, DebugData } from '../fixtures/electron.fixture';

/**
 * Wait for the app to be fully ready (Vue mounted + backend running)
 */
export async function waitForAppReady(
  window: Page,
  waitForBackend: (timeout?: number) => Promise<boolean>,
  timeout = 30000
): Promise<void> {
  // Wait for Vue to mount (look for the app container)
  await window.waitForSelector('#app', { timeout });

  // Wait for backend to be running
  const backendReady = await waitForBackend(timeout);
  if (!backendReady) {
    throw new Error('Backend failed to start within timeout');
  }
}

/**
 * Format RPC logs for readable console output
 */
export function formatRpcLogs(logs: DebugLogEntry[]): string {
  return logs
    .map((log) => {
      const duration = log.duration ? ` (${log.duration}ms)` : '';
      const data = log.data ? `\n    ${JSON.stringify(log.data, null, 2).replace(/\n/g, '\n    ')}` : '';
      return `[${log.type}] ${log.message}${duration}${data}`;
    })
    .join('\n\n');
}

/**
 * Assert that there are no RPC errors in the debug data
 */
export function assertNoRpcErrors(debugData: DebugData): void {
  if (debugData.hasErrors) {
    const errorLogs = debugData.logs.filter((log) => log.type === 'error');
    const errorMessages = errorLogs.map((log) => `${log.message}: ${JSON.stringify(log.data)}`).join('\n');
    throw new Error(`RPC errors detected:\n${errorMessages}`);
  }
}

/**
 * Print debug data to console in a format easy to analyze
 */
export function printDebugData(debugData: DebugData): void {
  console.log('\n=== Debug Data ===');
  console.log(`Backend Status: ${debugData.backendStatus}`);
  console.log(`Has Errors: ${debugData.hasErrors}`);

  if (debugData.logs.length > 0) {
    console.log('\n=== RPC Logs ===');
    console.log(formatRpcLogs(debugData.logs));
  }

  if (debugData.backendLogs.length > 0) {
    console.log('\n=== Backend Logs ===');
    debugData.backendLogs.slice(-20).forEach((log) => console.log(log));
  }
}

/**
 * Get the result data from an RPC response log
 */
export function getRpcResult<T>(log: DebugLogEntry | null): T | null {
  if (!log || log.type !== 'rpc-response') return null;
  return log.data as T;
}

/**
 * Wait for a specific element to appear and click it
 */
export async function clickWhenReady(window: Page, selector: string, timeout = 5000): Promise<void> {
  await window.waitForSelector(selector, { timeout });
  await window.click(selector);
}

/**
 * Type text into an input after waiting for it
 */
export async function typeWhenReady(
  window: Page,
  selector: string,
  text: string,
  timeout = 5000
): Promise<void> {
  await window.waitForSelector(selector, { timeout });
  await window.fill(selector, text);
}

/**
 * Click a button after waiting for it to be enabled.
 *
 * IMPORTANT: Always use this for submit buttons that may be disabled
 * based on form validation. Playwright's click() will execute on disabled
 * buttons but won't trigger the action.
 *
 * @param window - Playwright Page object
 * @param selector - Button selector (should include data-testid)
 * @param timeout - Max time to wait for button to be enabled
 */
export async function clickWhenEnabled(
  window: Page,
  selector: string,
  timeout = 5000
): Promise<void> {
  // Wait for the button to exist and not be disabled
  await window.waitForSelector(`${selector}:not([disabled])`, { timeout });
  await window.click(selector);
}

/**
 * Check for backend errors and fail immediately if found.
 *
 * Call this after any RPC operation to catch backend errors early
 * instead of waiting for timeouts.
 *
 * @param getDebugData - Function to get debug data from the app
 * @param context - Description of what operation was being performed
 */
export async function failFastOnBackendError(
  getDebugData: () => Promise<DebugData>,
  context: string
): Promise<void> {
  const debugData = await getDebugData();

  // Check for error logs
  const errorLogs = debugData.logs.filter((log) => log.type === 'error');
  if (errorLogs.length > 0) {
    const errorMessages = errorLogs
      .map((log) => {
        const data = log.data ? `\n  Data: ${JSON.stringify(log.data, null, 2)}` : '';
        return `${log.message}${data}`;
      })
      .join('\n\n');

    throw new Error(
      `Backend error during: ${context}\n\n` +
        `=== ERRORS ===\n${errorMessages}\n\n` +
        `=== BACKEND LOGS ===\n${debugData.backendLogs.slice(-20).join('\n')}`
    );
  }

  // Also check backend status
  if (debugData.backendStatus === 'error') {
    throw new Error(
      `Backend in error state during: ${context}\n\n` +
        `=== BACKEND LOGS ===\n${debugData.backendLogs.slice(-20).join('\n')}`
    );
  }
}
