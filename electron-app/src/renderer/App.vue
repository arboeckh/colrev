<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

// Types for the window API
declare global {
  interface Window {
    colrev: {
      start: () => Promise<{ success: boolean; error?: string }>;
      call: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
      stop: () => Promise<{ success: boolean }>;
      onLog: (callback: (msg: string) => void) => () => void;
      onError: (callback: (msg: string) => void) => () => void;
      onClose: (callback: (code: number | null) => void) => () => void;
    };
    appInfo: {
      get: () => Promise<{
        isPackaged: boolean;
        resourcesPath: string;
        appPath: string;
        version: string;
        projectsPath: string;
      }>;
    };
  }
}

// State
const backendStatus = ref<'stopped' | 'starting' | 'running' | 'error'>('stopped');
const error = ref<string | null>(null);
const logs = ref<string[]>([]);
const results = ref<{ action: string; data: unknown }[]>([]);
const projectId = ref(`test_${Date.now()}`);
const isLoading = ref(false);
const appInfo = ref<Record<string, unknown> | null>(null);
const basePath = ref('./projects'); // Will be updated from appInfo

// Cleanup functions for event listeners
let unsubLog: (() => void) | null = null;
let unsubError: (() => void) | null = null;
let unsubClose: (() => void) | null = null;

// Add log entry
function addLog(msg: string) {
  logs.value.push(`[${new Date().toLocaleTimeString()}] ${msg}`);
  // Keep last 50 logs
  if (logs.value.length > 50) {
    logs.value.shift();
  }
}

// Add result
function addResult(action: string, data: unknown) {
  results.value.unshift({ action, data });
  // Keep last 10 results
  if (results.value.length > 10) {
    results.value.pop();
  }
}

// Start backend
async function startBackend() {
  backendStatus.value = 'starting';
  error.value = null;
  addLog('Starting backend...');

  try {
    // Setup event listeners
    unsubLog = window.colrev.onLog((msg) => {
      addLog(`[backend] ${msg}`);
    });
    unsubError = window.colrev.onError((msg) => {
      addLog(`[error] ${msg}`);
    });
    unsubClose = window.colrev.onClose((code) => {
      addLog(`[close] Backend exited with code ${code}`);
      backendStatus.value = 'stopped';
    });

    const result = await window.colrev.start();
    if (result.success) {
      backendStatus.value = 'running';
      addLog('Backend started successfully');
    } else {
      backendStatus.value = 'error';
      error.value = result.error || 'Failed to start';
      addLog(`Failed to start: ${error.value}`);
    }
  } catch (err) {
    backendStatus.value = 'error';
    error.value = err instanceof Error ? err.message : 'Unknown error';
    addLog(`Error: ${error.value}`);
  }
}

// Stop backend
async function stopBackend() {
  addLog('Stopping backend...');
  await window.colrev.stop();
  backendStatus.value = 'stopped';

  // Cleanup listeners
  unsubLog?.();
  unsubError?.();
  unsubClose?.();
  unsubLog = unsubError = unsubClose = null;

  addLog('Backend stopped');
}

// Ping test
async function testPing() {
  isLoading.value = true;
  addLog('Testing ping...');
  try {
    const result = await window.colrev.call<{ status: string }>('ping', {});
    addResult('ping', result);
    addLog(`Ping response: ${JSON.stringify(result)}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    addResult('ping', { error: msg });
    addLog(`Ping failed: ${msg}`);
  } finally {
    isLoading.value = false;
  }
}

// Init project test
async function testInitProject() {
  isLoading.value = true;
  addLog(`Initializing project: ${projectId.value}`);
  try {
    const result = await window.colrev.call<{
      success: boolean;
      project_id: string;
      path: string;
      review_type: string;
      message: string;
    }>('init_project', {
      project_id: projectId.value,
      review_type: 'colrev.literature_review',
      example: true,
      force_mode: true,
      light: false,
      base_path: basePath.value,
    });
    addResult('init_project', result);
    addLog(`Project initialized: ${result.path}`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    addResult('init_project', { error: msg });
    addLog(`Init failed: ${msg}`);
  } finally {
    isLoading.value = false;
  }
}

// Get status test
async function testGetStatus() {
  isLoading.value = true;
  addLog(`Getting status for: ${projectId.value}`);
  try {
    const result = await window.colrev.call<{
      success: boolean;
      project_id: string;
      path: string;
      status: Record<string, unknown>;
    }>('get_status', {
      project_id: projectId.value,
      base_path: basePath.value,
    });
    addResult('get_status', result);
    addLog(`Status retrieved`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    addResult('get_status', { error: msg });
    addLog(`Get status failed: ${msg}`);
  } finally {
    isLoading.value = false;
  }
}

// Load app info on mount
onMounted(async () => {
  try {
    appInfo.value = await window.appInfo.get();
    // Use the projectsPath from Electron (writable location)
    if (appInfo.value.projectsPath) {
      basePath.value = appInfo.value.projectsPath as string;
    }
    addLog(`App info: isPackaged=${appInfo.value.isPackaged}`);
    addLog(`Projects path: ${basePath.value}`);
  } catch (err) {
    addLog(`Failed to get app info: ${err}`);
  }
});

// Cleanup on unmount
onUnmounted(() => {
  unsubLog?.();
  unsubError?.();
  unsubClose?.();
});
</script>

<template>
  <div class=" min-h-screen bg-background text-foreground">
    <div class="max-w-[900px] mx-auto p-5">
      <header class="text-center mb-8">
        <h1 class="text-2xl font-bold text-primary">CoLRev Electron POC</h1>
        <p class="text-muted-foreground mt-1">JSON-RPC Integration Test</p>
      </header>

      <main class="space-y-5">
        <!-- Backend Status -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-lg text-primary">Backend Status</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="flex items-center gap-4">
              <span class="px-4 py-1.5 rounded font-bold text-sm" :class="{
                'bg-muted text-muted-foreground': backendStatus === 'stopped',
                'bg-yellow-500 text-black': backendStatus === 'starting',
                'bg-green-500 text-black': backendStatus === 'running',
                'bg-destructive text-white': backendStatus === 'error',
              }">
                {{ backendStatus.toUpperCase() }}
              </span>
              <Button v-if="backendStatus === 'stopped' || backendStatus === 'error'" @click="startBackend"
                :disabled="backendStatus === 'starting'">
                Start Backend
              </Button>
              <Button v-if="backendStatus === 'running'" @click="stopBackend" variant="secondary">
                Stop Backend
              </Button>
            </div>
            <p v-if="error" class="text-destructive mt-3">{{ error }}</p>
          </CardContent>
        </Card>

        <!-- Test Controls -->
        <Card :class="{ 'opacity-50 pointer-events-none': backendStatus !== 'running' }">
          <CardHeader class="pb-3">
            <CardTitle class="text-lg text-primary">Tests</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div class="flex items-center gap-4">
              <Button @click="testPing" :disabled="backendStatus !== 'running' || isLoading">
                1. Ping
              </Button>
              <span class="text-muted-foreground text-sm">Health check - should return "pong"</span>
            </div>

            <div class="flex items-center gap-3">
              <label class="text-sm font-medium">Project ID:</label>
              <Input v-model="projectId" :disabled="backendStatus !== 'running' || isLoading" class="w-64" />
            </div>

            <div class="flex items-center gap-4">
              <Button @click="testInitProject" :disabled="backendStatus !== 'running' || isLoading">
                2. Init Project
              </Button>
              <span class="text-muted-foreground text-sm">Creates project with example data (30 records)</span>
            </div>

            <div class="flex items-center gap-4">
              <Button @click="testGetStatus" :disabled="backendStatus !== 'running' || isLoading">
                3. Get Status
              </Button>
              <span class="text-muted-foreground text-sm">Retrieves project status</span>
            </div>

            <p v-if="isLoading" class="text-yellow-500 italic">Processing...</p>
          </CardContent>
        </Card>

        <!-- Results -->
        <Card v-if="results.length > 0">
          <CardHeader class="pb-3">
            <CardTitle class="text-lg text-primary">Results</CardTitle>
          </CardHeader>
          <CardContent class="space-y-3">
            <div v-for="(r, i) in results" :key="i" class="bg-muted p-3 rounded">
              <strong class="text-primary">{{ r.action }}</strong>
              <pre class="mt-2 text-sm overflow-x-auto whitespace-pre-wrap">{{ JSON.stringify(r.data, null, 2) }}</pre>
            </div>
          </CardContent>
        </Card>

        <!-- Logs -->
        <Card>
          <CardHeader class="pb-3">
            <CardTitle class="text-lg text-primary">Logs</CardTitle>
          </CardHeader>
          <CardContent>
            <div class="bg-muted p-3 rounded max-h-[200px] overflow-y-auto font-mono text-xs">
              <div v-for="(log, i) in logs" :key="i" class="my-0.5 whitespace-pre-wrap">{{ log }}</div>
              <div v-if="logs.length === 0" class="text-muted-foreground">No logs yet</div>
            </div>
          </CardContent>
        </Card>
      </main>

      <footer v-if="appInfo" class="text-center text-muted-foreground mt-8">
        <small>
          isPackaged: {{ appInfo.isPackaged }} |
          appPath: {{ appInfo.appPath }}
        </small>
      </footer>
    </div>
  </div>
</template>
