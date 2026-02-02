# CoLRev JSON-RPC Server

End-to-end proof of concept for running CoLRev as an in-process backend via JSON-RPC 2.0 over stdio. Designed for integration with Electron desktop applications.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│ Electron App                                                    │
│  ┌──────────────┐      IPC       ┌──────────────────────────┐  │
│  │ Vue.js       │◄──────────────►│ Main Process             │  │
│  │ (Renderer)   │                │                          │  │
│  │              │                │  ┌────────────────────┐  │  │
│  │ TypeScript   │                │  │ colrev-jsonrpc     │  │  │
│  │ Interfaces   │                │  │ (subprocess)       │  │  │
│  └──────────────┘                │  │                    │  │  │
│                                  │  │ stdin ──► request  │  │  │
│                                  │  │ stdout ◄── response│  │  │
│                                  │  │ stderr ──► logs    │  │  │
│                                  │  └────────────────────┘  │  │
│                                  └──────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

**Protocol:** JSON-RPC 2.0 over stdio (line-delimited JSON)
- Requests: Write JSON + newline to stdin
- Responses: Read JSON + newline from stdout
- Logs: stderr (doesn't interfere with RPC)

**Why stdio?** No port conflicts, no network exposure, simple process lifecycle tied to parent.

## Quick Start

### Build Executable

```bash
pip install pyinstaller
./build_jsonrpc.sh
# Output: dist/colrev-jsonrpc
```

### Run (Development)

```bash
# Via Python module (fast iteration)
python main.py

# Via installed package
colrev-jsonrpc
```

### Test

```bash
# Comprehensive workflow test
python test_jsonrpc_client.py

# Quick ping test
echo '{"jsonrpc":"2.0","method":"ping","params":{},"id":1}' | python main.py
```

## API Methods

| Method | Parameters | Description |
|--------|------------|-------------|
| `ping` | - | Health check, returns `{"status":"pong"}` |
| `init_project` | `project_id`, `review_type?`, `example?`, `force_mode?`, `light?`, `base_path?` | Create new CoLRev project |
| `get_status` | `project_id`, `base_path?` | Get project status and record counts |
| `validate` | `project_id`, `base_path?` | Validate project data quality |
| `search` | `project_id`, `base_path?`, `source?`, `rerun?`, `skip_commit?` | Execute search operation |
| `load` | `project_id`, `base_path?`, `keep_ids?` | Import search results |
| `prep` | `project_id`, `base_path?`, `skip_commit?` | Prepare/clean metadata |
| `dedupe` | `project_id`, `base_path?` | Deduplicate records |
| `prescreen` | `project_id`, `base_path?`, `split_str?` | Initial screening |
| `pdf_get` | `project_id`, `base_path?` | Retrieve PDFs |
| `pdf_prep` | `project_id`, `base_path?`, `reprocess?`, `batch_size?` | Prepare/validate PDFs |
| `screen` | `project_id`, `base_path?` | Full-text screening |
| `data` | `project_id`, `base_path?` | Data extraction/synthesis |

**Common parameters:**
- `project_id` (required): Alphanumeric identifier, sanitized for path safety
- `base_path` (optional): Base directory for projects, default `./projects`

## Electron Integration

### Main Process: Backend Manager

```typescript
// src/main/colrev-backend.ts
import { spawn, ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import * as readline from 'readline';
import * as path from 'path';
import { app } from 'electron';

export class ColrevBackend extends EventEmitter {
  private process: ChildProcess | null = null;
  private requestId = 0;
  private pending = new Map<number, { resolve: Function; reject: Function }>();
  private rl: readline.Interface | null = null;

  constructor(private executablePath?: string) {
    super();
    // Default: bundled executable in app resources
    this.executablePath = executablePath ?? path.join(
      app.isPackaged ? process.resourcesPath : __dirname,
      'colrev-jsonrpc'
    );
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.process = spawn(this.executablePath!, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse stdout line-by-line for JSON-RPC responses
      this.rl = readline.createInterface({ input: this.process.stdout! });
      this.rl.on('line', (line) => {
        try {
          const response = JSON.parse(line);
          const pending = this.pending.get(response.id);
          if (pending) {
            this.pending.delete(response.id);
            if (response.error) {
              pending.reject(new Error(`${response.error.code}: ${response.error.message}`));
            } else {
              pending.resolve(response.result);
            }
          }
        } catch (e) {
          this.emit('error', e);
        }
      });

      // Forward stderr to logs
      this.process.stderr?.on('data', (data) => {
        this.emit('log', data.toString());
      });

      this.process.on('error', reject);
      this.process.on('close', (code) => {
        this.emit('close', code);
        this.process = null;
      });

      // Verify server is responding
      this.call('ping', {})
        .then(() => resolve())
        .catch(reject);
    });
  }

  call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.process?.stdin) {
        return reject(new Error('Backend not running'));
      }

      const id = ++this.requestId;
      this.pending.set(id, { resolve, reject });

      const request = { jsonrpc: '2.0', method, params, id };
      this.process.stdin.write(JSON.stringify(request) + '\n');

      // Timeout after 60s
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error('Request timeout'));
        }
      }, 60000);
    });
  }

  stop(): void {
    if (this.process) {
      this.process.kill();
      this.process = null;
    }
  }
}
```

### Main Process: IPC Bridge

```typescript
// src/main/ipc-handlers.ts
import { ipcMain, BrowserWindow } from 'electron';
import { ColrevBackend } from './colrev-backend';

let backend: ColrevBackend;

export function setupColrevIPC(mainWindow: BrowserWindow) {
  backend = new ColrevBackend();

  // Forward logs to renderer
  backend.on('log', (msg) => mainWindow.webContents.send('colrev:log', msg));
  backend.on('close', (code) => mainWindow.webContents.send('colrev:close', code));

  // Start backend when app is ready
  ipcMain.handle('colrev:start', async () => {
    await backend.start();
    return true;
  });

  // Generic RPC call handler
  ipcMain.handle('colrev:call', async (_, method: string, params: Record<string, unknown>) => {
    return backend.call(method, params);
  });

  // Stop backend
  ipcMain.handle('colrev:stop', async () => {
    backend.stop();
    return true;
  });
}

// Call in main.ts before app.on('ready')
export function cleanupColrev() {
  backend?.stop();
}
```

### Preload Script

```typescript
// src/preload/index.ts
import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('colrev', {
  start: () => ipcRenderer.invoke('colrev:start'),
  call: (method: string, params: Record<string, unknown>) =>
    ipcRenderer.invoke('colrev:call', method, params),
  stop: () => ipcRenderer.invoke('colrev:stop'),
  onLog: (callback: (msg: string) => void) =>
    ipcRenderer.on('colrev:log', (_, msg) => callback(msg)),
  onClose: (callback: (code: number) => void) =>
    ipcRenderer.on('colrev:close', (_, code) => callback(code)),
});
```

## Vue.js + TypeScript

### Type Definitions

```typescript
// src/types/colrev.ts

// JSON-RPC base types
export interface JsonRpcError {
  code: number;
  message: string;
  data?: string;
}

// Parameter types
export interface InitProjectParams {
  project_id: string;
  review_type?: string;  // default: 'colrev.literature_review'
  example?: boolean;     // default: false
  force_mode?: boolean;  // default: true
  light?: boolean;       // default: false
  base_path?: string;    // default: './projects'
}

export interface ProjectParams {
  project_id: string;
  base_path?: string;
}

export interface SearchParams extends ProjectParams {
  source?: string;       // default: 'all'
  rerun?: boolean;
  skip_commit?: boolean;
}

export interface PrepParams extends ProjectParams {
  skip_commit?: boolean;
}

export interface LoadParams extends ProjectParams {
  keep_ids?: boolean;
}

export interface PrescreenParams extends ProjectParams {
  split_str?: string;    // default: 'NA'
}

export interface PdfPrepParams extends ProjectParams {
  reprocess?: boolean;
  batch_size?: number;   // default: 0
}

// Result types
export interface OperationResult {
  success: boolean;
  operation?: string;
  project_id: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface InitProjectResult extends OperationResult {
  path: string;
  review_type: string;
}

export interface ProjectStatus {
  success: boolean;
  project_id: string;
  path: string;
  status: {
    overall: { atomic_steps: number; completed_atomic_steps: number };
    currently: { [key: string]: number };
    [key: string]: unknown;
  };
}

export interface PingResult {
  status: 'pong';
}

// Window augmentation for preload
declare global {
  interface Window {
    colrev: {
      start: () => Promise<boolean>;
      call: <T>(method: string, params: Record<string, unknown>) => Promise<T>;
      stop: () => Promise<boolean>;
      onLog: (callback: (msg: string) => void) => void;
      onClose: (callback: (code: number) => void) => void;
    };
  }
}
```

### Vue Composable

```typescript
// src/composables/useColrev.ts
import { ref, onMounted, onUnmounted } from 'vue';
import type {
  InitProjectParams,
  InitProjectResult,
  ProjectParams,
  ProjectStatus,
  SearchParams,
  PrepParams,
  LoadParams,
  PrescreenParams,
  PdfPrepParams,
  OperationResult,
  PingResult,
} from '@/types/colrev';

export function useColrev() {
  const isRunning = ref(false);
  const isLoading = ref(false);
  const error = ref<string | null>(null);
  const logs = ref<string[]>([]);

  // Start backend on mount
  onMounted(async () => {
    try {
      await window.colrev.start();
      isRunning.value = true;

      window.colrev.onLog((msg) => {
        logs.value.push(msg);
        // Keep last 100 logs
        if (logs.value.length > 100) logs.value.shift();
      });

      window.colrev.onClose(() => {
        isRunning.value = false;
      });
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Failed to start backend';
    }
  });

  // Stop backend on unmount
  onUnmounted(() => {
    window.colrev.stop();
  });

  // Generic call wrapper with loading state
  async function call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    isLoading.value = true;
    error.value = null;
    try {
      return await window.colrev.call<T>(method, params);
    } catch (e) {
      error.value = e instanceof Error ? e.message : 'Unknown error';
      throw e;
    } finally {
      isLoading.value = false;
    }
  }

  // Typed API methods
  const api = {
    ping: () => call<PingResult>('ping', {}),

    initProject: (params: InitProjectParams) =>
      call<InitProjectResult>('init_project', params),

    getStatus: (params: ProjectParams) =>
      call<ProjectStatus>('get_status', params),

    validate: (params: ProjectParams) =>
      call<OperationResult>('validate', params),

    search: (params: SearchParams) =>
      call<OperationResult>('search', params),

    load: (params: LoadParams) =>
      call<OperationResult>('load', params),

    prep: (params: PrepParams) =>
      call<OperationResult>('prep', params),

    dedupe: (params: ProjectParams) =>
      call<OperationResult>('dedupe', params),

    prescreen: (params: PrescreenParams) =>
      call<OperationResult>('prescreen', params),

    pdfGet: (params: ProjectParams) =>
      call<OperationResult>('pdf_get', params),

    pdfPrep: (params: PdfPrepParams) =>
      call<OperationResult>('pdf_prep', params),

    screen: (params: ProjectParams) =>
      call<OperationResult>('screen', params),

    data: (params: ProjectParams) =>
      call<OperationResult>('data', params),
  };

  return {
    isRunning,
    isLoading,
    error,
    logs,
    api,
  };
}
```

### Component Example

```vue
<!-- src/components/ProjectManager.vue -->
<script setup lang="ts">
import { ref } from 'vue';
import { useColrev } from '@/composables/useColrev';

const { isRunning, isLoading, error, api } = useColrev();

const projectId = ref('');
const status = ref<Record<string, unknown> | null>(null);
const message = ref('');

async function createProject() {
  try {
    const result = await api.initProject({
      project_id: projectId.value,
      review_type: 'colrev.literature_review',
      example: true,  // Include sample records
    });
    message.value = result.message;
    await refreshStatus();
  } catch (e) {
    // error.value is already set by composable
  }
}

async function refreshStatus() {
  if (!projectId.value) return;
  const result = await api.getStatus({ project_id: projectId.value });
  status.value = result.status;
}

async function runWorkflow() {
  const params = { project_id: projectId.value };

  // Execute workflow steps sequentially
  await api.load(params);
  await api.prep(params);
  await api.dedupe(params);
  await api.prescreen(params);
  await api.screen(params);
  await api.data(params);

  await refreshStatus();
  message.value = 'Workflow completed';
}
</script>

<template>
  <div class="project-manager">
    <div v-if="!isRunning" class="status-banner warning">
      Backend not running
    </div>

    <div v-if="error" class="status-banner error">
      {{ error }}
    </div>

    <div class="controls">
      <input
        v-model="projectId"
        placeholder="Project ID"
        :disabled="isLoading"
      />
      <button @click="createProject" :disabled="!isRunning || isLoading">
        Create Project
      </button>
      <button @click="runWorkflow" :disabled="!isRunning || isLoading || !projectId">
        Run Workflow
      </button>
    </div>

    <div v-if="isLoading" class="loading">Processing...</div>

    <div v-if="message" class="message">{{ message }}</div>

    <pre v-if="status" class="status">{{ JSON.stringify(status, null, 2) }}</pre>
  </div>
</template>
```

## Error Codes

| Code | Type | Description |
|------|------|-------------|
| -32700 | Parse error | Invalid JSON |
| -32600 | Invalid Request | Missing required fields |
| -32601 | Method not found | Unknown method |
| -32602 | Invalid params | Parameter validation failed |
| -32603 | Internal error | Server error |
| -32000 | Repository setup | CoLRev repo not found/invalid |
| -32001 | Operation error | CoLRev operation failed |
| -32002 | Service unavailable | External service down |
| -32003 | Missing dependency | Required package missing |
| -32004 | Parameter error | Invalid parameter value |

## Project Structure

```
./projects/{project_id}/
├── .git/                    # Auto-initialized
├── .pre-commit-config.yaml  # Quality hooks
├── settings.json            # CoLRev config
├── readme.md
└── data/
    ├── records.bib          # Bibliography
    ├── search/              # Search results
    └── pdfs/                # PDF storage
```

## Files

```
colrev/
├── main.py                  # PyInstaller entry point
├── test_jsonrpc_client.py   # Python test client
├── build_jsonrpc.sh         # Build script
├── colrev_jsonrpc.spec      # PyInstaller spec
└── colrev/ui_jsonrpc/
    ├── server.py            # Stdio server loop
    ├── handler.py           # Request routing
    ├── handlers/            # Operation handlers
    ├── validation.py        # Parameter validation
    ├── error_handler.py     # Exception mapping
    └── response_formatter.py
```
