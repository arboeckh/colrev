import { test, expect } from '../fixtures/electron.fixture';
import { printDebugData } from '../helpers/test-utils';

test.describe('App Launch', () => {
  test('should launch the Electron app', async ({ window }) => {
    // Verify the window title
    const title = await window.title();
    console.log(`Window title: ${title}`);

    // Verify the app container exists
    const appElement = await window.locator('#app');
    await expect(appElement).toBeVisible();

    console.log('App launched successfully');
  });

  test('should show landing page and backend status', async ({ window, getDebugData, waitForBackend }) => {
    // Wait for app to load
    await window.waitForSelector('#app', { timeout: 10000 });

    // Give the app a moment to initialize
    await window.waitForTimeout(1000);

    // Get initial debug data
    const debugData = await getDebugData();
    console.log('\n=== Initial State ===');
    console.log(`Backend Status: ${debugData.backendStatus}`);
    console.log(`Log count: ${debugData.logs.length}`);

    // Wait for backend to start (or check if already started)
    console.log('\nWaiting for backend to be ready...');
    const backendReady = await waitForBackend(30000);

    // Get final debug data
    const finalDebugData = await getDebugData();
    printDebugData(finalDebugData);

    // Assert backend started
    expect(backendReady).toBe(true);
    expect(finalDebugData.backendStatus).toBe('running');
  });

  test('should display backend logs', async ({ window, getDebugData, waitForBackend }) => {
    await window.waitForSelector('#app', { timeout: 10000 });

    // Wait for backend
    await waitForBackend(30000);

    // Get debug data
    const debugData = await getDebugData();

    console.log('\n=== Backend Logs ===');
    debugData.backendLogs.forEach((log) => console.log(log));

    // Should have some logs from startup
    expect(debugData.backendLogs.length).toBeGreaterThan(0);
  });
});
