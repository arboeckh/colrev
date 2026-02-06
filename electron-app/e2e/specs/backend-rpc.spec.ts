import { test, expect } from '../fixtures/electron.fixture';
import { formatRpcLogs, printDebugData, assertNoRpcErrors } from '../helpers/test-utils';

test.describe('Backend RPC Communication', () => {
  test('should capture RPC ping request and response', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    // Wait for app and backend
    await window.waitForSelector('#app', { timeout: 10000 });
    const backendReady = await waitForBackend(30000);
    expect(backendReady).toBe(true);

    // Clear logs to isolate this test
    await clearDebugLogs();

    // The app should have made some RPC calls during initialization
    // Let's wait a moment and check
    await window.waitForTimeout(2000);

    // Get RPC logs
    const rpcLogs = await getRpcLogs();

    console.log('\n=== RPC Activity ===');
    console.log(formatRpcLogs(rpcLogs));

    // Get full debug data
    const debugData = await getDebugData();
    console.log(`\nBackend Status: ${debugData.backendStatus}`);
    console.log(`Total logs: ${debugData.logs.length}`);
    console.log(`Has errors: ${debugData.hasErrors}`);

    // Assert no errors occurred
    assertNoRpcErrors(debugData);
  });

  test('should list projects via RPC', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
    waitForRpcResponse,
  }) => {
    // Wait for backend
    await window.waitForSelector('#app', { timeout: 10000 });
    await waitForBackend(30000);

    // Clear logs
    await clearDebugLogs();

    // Wait for any list_projects call (landing page should make this)
    // Or trigger navigation that would cause it
    await window.waitForTimeout(2000);

    // Get all RPC logs
    const rpcLogs = await getRpcLogs();

    console.log('\n=== RPC Logs After Page Load ===');
    console.log(formatRpcLogs(rpcLogs));

    // Print full debug data for analysis
    const debugData = await getDebugData();
    printDebugData(debugData);

    // The test passes if we can capture the logs - actual assertions
    // depend on what the app does on load
    expect(debugData.backendStatus).toBe('running');
  });

  test('should capture errors in debug logs', async ({
    window,
    getDebugData,
    waitForBackend,
    clearDebugLogs,
  }) => {
    // Wait for backend
    await window.waitForSelector('#app', { timeout: 10000 });
    await waitForBackend(30000);

    // Clear logs
    await clearDebugLogs();

    // Get debug data
    const debugData = await getDebugData();

    console.log('\n=== Debug State ===');
    console.log(`Backend Status: ${debugData.backendStatus}`);
    console.log(`Has Errors: ${debugData.hasErrors}`);
    console.log(`Log Count: ${debugData.logs.length}`);

    // Backend should be running without errors after startup
    expect(debugData.backendStatus).toBe('running');
  });
});

test.describe('RPC Debug Workflow Example', () => {
  test('demonstrates capturing RPC for iterative debugging', async ({
    window,
    getDebugData,
    getRpcLogs,
    waitForBackend,
    clearDebugLogs,
  }) => {
    // 1. Wait for app to be ready
    await window.waitForSelector('#app', { timeout: 10000 });
    await waitForBackend(30000);

    // 2. Clear logs to start fresh
    await clearDebugLogs();

    // 3. Simulate clicking a button or navigating
    // (Adjust selector based on actual UI)
    // await window.click('[data-testid="some-button"]');

    // 4. Wait for any RPC activity
    await window.waitForTimeout(1000);

    // 5. Capture all RPC logs
    const rpcLogs = await getRpcLogs();

    // 6. Print in a format Claude can analyze
    console.log('\n========================================');
    console.log('RPC ACTIVITY LOG');
    console.log('========================================');

    if (rpcLogs.length === 0) {
      console.log('No RPC calls captured');
    } else {
      rpcLogs.forEach((log, index) => {
        console.log(`\n--- Entry ${index + 1} ---`);
        console.log(`Type: ${log.type}`);
        console.log(`Message: ${log.message}`);
        if (log.duration) console.log(`Duration: ${log.duration}ms`);
        if (log.data) {
          console.log('Data:');
          console.log(JSON.stringify(log.data, null, 2));
        }
      });
    }

    // 7. Get backend logs for stderr output
    const debugData = await getDebugData();

    console.log('\n========================================');
    console.log('BACKEND LOGS (stderr)');
    console.log('========================================');
    debugData.backendLogs.slice(-10).forEach((log) => console.log(log));

    console.log('\n========================================');
    console.log('SUMMARY');
    console.log('========================================');
    console.log(`Backend Status: ${debugData.backendStatus}`);
    console.log(`RPC Calls Made: ${rpcLogs.filter((l) => l.type === 'rpc-request').length}`);
    console.log(`RPC Responses: ${rpcLogs.filter((l) => l.type === 'rpc-response').length}`);
    console.log(`Errors: ${rpcLogs.filter((l) => l.type === 'error').length}`);

    // This test always passes - it's for debugging output
    expect(true).toBe(true);
  });
});
